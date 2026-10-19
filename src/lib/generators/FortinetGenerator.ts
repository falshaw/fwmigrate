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

export class FortinetGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "FORTINET";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = [];

    // Address objects
    configLines.push("config firewall address");
    for (const obj of objects) {
      if (obj.objectType === "address" && obj.members.length > 0) {
        configLines.push(`    edit "${obj.name}"`);
        const member = obj.members[0];
        if (member.includes("/"))
          configLines.push(`        set subnet ${member.replace("/", " ")}`);
        else configLines.push(`        set subnet ${member} 255.255.255.255`);
        configLines.push("    next");
        objectsCreated.push(obj.name);
      }
    }
    configLines.push("end");

    // Policies
    configLines.push("");
    configLines.push("config firewall policy");
    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `Policy ${rule.position}: ${rule.action} from ${rule.sourceZone || "any"} to ${rule.destinationZone || "any"}`,
        warnings: [],
      });
    }
    configLines.push("end");

    return {
      config: configLines.join("\n"),
      ruleConfigs,
      warnings,
      objectsCreated,
    };
  }

  generateRule(rule: NormalizedRule, zoneMappings: ZoneMapping[]): string {
    const srcIntf = this.mapZone(rule.sourceZone, zoneMappings) || "any";
    const dstIntf = this.mapZone(rule.destinationZone, zoneMappings) || "any";
    const action = rule.action === "permit" ? "accept" : "deny";
    const lines: string[] = [];

    lines.push(`    edit ${rule.position}`);
    lines.push(`        set name "${rule.name}"`);
    lines.push(`        set srcintf "${srcIntf}"`);
    lines.push(`        set dstintf "${dstIntf}"`);
    lines.push(
      `        set srcaddr ${rule.sources.map((s) => `"${s}"`).join(" ")}`,
    );
    lines.push(
      `        set dstaddr ${rule.destinations.map((d) => `"${d}"`).join(" ")}`,
    );
    lines.push(
      `        set service ${rule.services.map((s) => `"${s}"`).join(" ")}`,
    );
    lines.push(`        set action ${action}`);
    lines.push(`        set schedule "always"`);
    if (rule.logging) lines.push(`        set logtraffic all`);
    if (!rule.enabled) lines.push(`        set status disable`);
    if (rule.description)
      lines.push(`        set comments "${rule.description}"`);
    lines.push("    next");

    return lines.join("\n");
  }

  generateRollback(
    rule: NormalizedRule,
    _zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `config firewall policy\n    delete ${rule.position}\nend`,
      explanation: `Delete migrated policy ${rule.position} ("${rule.name}") from FortiGate`,
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
