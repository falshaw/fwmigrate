/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type {
  IConfigGenerator,
  GeneratorResult,
  RuleConfig,
  RollbackCommand,
  ZoneMapping,
} from "./GeneratorInterface";
import type {
  FirewallVendor,
  NormalizedRule,
  NormalizedObject,
} from "../parsers/types";

export class CiscoASAGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "CISCO_ASA";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = [];

    // Generate objects
    configLines.push("! --- Network Objects ---");
    for (const obj of objects) {
      if (obj.objectType === "address") {
        configLines.push(`object network ${obj.name}`);
        for (const member of obj.members) {
          if (member.endsWith("/32"))
            configLines.push(` host ${member.replace("/32", "")}`);
          else configLines.push(` subnet ${this.cidrToSubnet(member)}`);
        }
        objectsCreated.push(obj.name);
      } else if (obj.objectType === "address-group") {
        configLines.push(`object-group network ${obj.name}`);
        for (const member of obj.members)
          configLines.push(` network-object object ${member}`);
        objectsCreated.push(obj.name);
      }
    }

    // Generate ACLs
    const aclName =
      this.mapZone(rules[0]?.sourceZone, zoneMappings) || "OUTSIDE_IN";
    configLines.push("");
    configLines.push(`! --- Access List: ${aclName} ---`);

    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `${rule.action} ${rule.services.join(",")} from ${rule.sources.join(",")} to ${rule.destinations.join(",")}`,
        warnings: [],
      });
    }

    return {
      config: configLines.join("\n"),
      ruleConfigs,
      warnings,
      objectsCreated,
    };
  }

  generateRule(rule: NormalizedRule, zoneMappings: ZoneMapping[]): string {
    const aclName = this.mapZone(rule.sourceZone, zoneMappings) || "OUTSIDE_IN";
    const action = rule.action === "permit" ? "permit" : "deny";
    const protocol = this.extractProtocol(rule.services);
    const src = this.formatAddress(rule.sources);
    const dst = this.formatAddress(rule.destinations);
    const port = this.extractPort(rule.services);

    let line = `access-list ${aclName} extended ${action} ${protocol} ${src} ${dst}`;
    if (port) line += ` ${port}`;
    if (rule.logging) line += " log";

    return line;
  }

  generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    const aclName = this.mapZone(rule.sourceZone, zoneMappings) || "OUTSIDE_IN";
    const ruleConfig = this.generateRule(rule, zoneMappings);
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `no ${ruleConfig}`,
      explanation: `Remove migrated ACE from ${aclName} access-list`,
    };
  }

  private mapZone(
    zone: string | undefined,
    mappings: ZoneMapping[],
  ): string | undefined {
    if (!zone) return undefined;
    const mapping = mappings.find(
      (m) => m.sourceZone.toLowerCase() === zone.toLowerCase(),
    );
    return mapping?.targetZone || zone;
  }

  private formatAddress(addrs: string[]): string {
    if (addrs.length === 0 || addrs[0] === "any") return "any";
    const addr = addrs[0];
    if (addr.endsWith("/32")) return `host ${addr.replace("/32", "")}`;
    if (addr.includes("/")) {
      const [ip, cidr] = addr.split("/");
      return `${ip} ${this.cidrToMask(parseInt(cidr))}`;
    }
    return `object-group ${addr}`;
  }

  private extractProtocol(services: string[]): string {
    if (!services.length || services[0] === "any") return "ip";
    const svc = services[0];
    if (svc.startsWith("tcp/")) return "tcp";
    if (svc.startsWith("udp/")) return "udp";
    if (svc === "icmp") return "icmp";
    return "ip";
  }

  private extractPort(services: string[]): string {
    if (!services.length || services[0] === "any") return "";
    const svc = services[0];
    const match = svc.match(/^(?:tcp|udp)\/(\S+)$/);
    if (match) {
      if (match[1].includes("-")) return `range ${match[1].replace("-", " ")}`;
      return `eq ${match[1]}`;
    }
    return "";
  }

  private cidrToMask(cidr: number): string {
    const mask = ~((1 << (32 - cidr)) - 1) >>> 0;
    return `${(mask >>> 24) & 255}.${(mask >>> 16) & 255}.${(mask >>> 8) & 255}.${mask & 255}`;
  }

  private cidrToSubnet(cidr: string): string {
    const [ip, bits] = cidr.split("/");
    return `${ip} ${this.cidrToMask(parseInt(bits))}`;
  }
}
