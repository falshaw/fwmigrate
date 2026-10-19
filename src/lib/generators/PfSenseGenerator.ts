/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * pfSense config generator
 * Generates pfSense XML configuration format
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

export class PfSenseGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "PFSENSE";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = [];

    configLines.push('<?xml version="1.0"?>');
    configLines.push("<pfsense>");

    // Aliases
    configLines.push("  <aliases>");
    for (const obj of objects) {
      if (obj.members.length > 0) {
        configLines.push("    <alias>");
        configLines.push(`      <name>${obj.name}</name>`);
        configLines.push(
          `      <type>${obj.objectType === "address" ? "host" : "network"}</type>`,
        );
        configLines.push(`      <address>${obj.members.join(" ")}</address>`);
        configLines.push("    </alias>");
        objectsCreated.push(obj.name);
      }
    }
    configLines.push("  </aliases>");

    // Filter rules
    configLines.push("  <filter>");
    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `Rule ${rule.position}: ${rule.action} on ${rule.sourceZone || "any"}`,
        warnings: [],
      });
    }
    configLines.push("  </filter>");

    configLines.push("</pfsense>");

    return {
      config: configLines.join("\n"),
      ruleConfigs,
      warnings,
      objectsCreated,
    };
  }

  generateRule(rule: NormalizedRule, zoneMappings: ZoneMapping[]): string {
    const iface = this.mapZone(rule.sourceZone, zoneMappings) || "lan";
    const type = rule.action === "permit" ? "pass" : "block";
    const lines: string[] = [];

    lines.push("    <rule>");
    lines.push(`      <type>${type}</type>`);
    lines.push(`      <interface>${iface}</interface>`);
    lines.push(`      <descr>${rule.name}</descr>`);
    if (!rule.enabled) lines.push("      <disabled>1</disabled>");
    if (rule.logging) lines.push("      <log>1</log>");

    // Protocol and port
    const svc = rule.services[0];
    if (svc && svc !== "any") {
      const [proto, port] = svc.split("/");
      lines.push(`      <protocol>${proto}</protocol>`);
      if (port) lines.push(`      <dstport>${port}</dstport>`);
    }

    // Source
    const src = rule.sources[0];
    if (src && src !== "any") {
      lines.push("      <source>");
      lines.push(`        <address>${src}</address>`);
      lines.push("      </source>");
    } else {
      lines.push("      <source>any</source>");
    }

    // Destination
    const dst = rule.destinations[0];
    if (dst && dst !== "any") {
      lines.push("      <destination>");
      lines.push(`        <address>${dst}</address>`);
      lines.push("      </destination>");
    } else {
      lines.push("      <destination>any</destination>");
    }

    lines.push("    </rule>");

    return lines.join("\n");
  }

  generateRollback(
    rule: NormalizedRule,
    _zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `Remove filter rule "${rule.name}" (position ${rule.position}) from pfSense`,
      explanation: `Delete migrated rule "${rule.name}" from pfSense firewall filter`,
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
}
