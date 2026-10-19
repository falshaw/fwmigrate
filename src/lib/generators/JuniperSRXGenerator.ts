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

export class JuniperSRXGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "JUNIPER_SRX";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = ["# Juniper SRX Configuration", ""];

    // Address book entries
    configLines.push("# Global Address Book");
    for (const obj of objects) {
      if (obj.objectType === "address" && obj.members.length > 0) {
        configLines.push(
          `set security address-book global address ${obj.name} ${obj.members[0]}`,
        );
        objectsCreated.push(obj.name);
      } else if (obj.objectType === "address-group") {
        for (const member of obj.members) {
          configLines.push(
            `set security address-book global address-set ${obj.name} address ${member}`,
          );
        }
        objectsCreated.push(obj.name);
      }
    }

    configLines.push("");
    configLines.push("# Security Policies");

    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `Policy ${rule.name}: ${rule.action} from ${rule.sourceZone || "any"} to ${rule.destinationZone || "any"}`,
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
    const fromZone = this.mapZone(rule.sourceZone, zoneMappings) || "trust";
    const toZone =
      this.mapZone(rule.destinationZone, zoneMappings) || "untrust";
    const action =
      rule.action === "permit"
        ? "permit"
        : rule.action === "drop"
          ? "reject"
          : "deny";
    const name = rule.name.replace(/\s+/g, "_");

    const lines: string[] = [];
    for (const src of rule.sources) {
      lines.push(
        `set security policies from-zone ${fromZone} to-zone ${toZone} policy ${name} match source-address ${src}`,
      );
    }
    for (const dst of rule.destinations) {
      lines.push(
        `set security policies from-zone ${fromZone} to-zone ${toZone} policy ${name} match destination-address ${dst}`,
      );
    }
    for (const svc of rule.services) {
      lines.push(
        `set security policies from-zone ${fromZone} to-zone ${toZone} policy ${name} match application ${svc}`,
      );
    }
    lines.push(
      `set security policies from-zone ${fromZone} to-zone ${toZone} policy ${name} then ${action}`,
    );
    if (rule.logging) {
      lines.push(
        `set security policies from-zone ${fromZone} to-zone ${toZone} policy ${name} then log session-close`,
      );
    }

    return lines.join("\n");
  }

  generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    const fromZone = this.mapZone(rule.sourceZone, zoneMappings) || "untrust";
    const toZone = this.mapZone(rule.destinationZone, zoneMappings) || "trust";
    const name = rule.name.replace(/\s+/g, "_");
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `delete security policies from-zone ${fromZone} to-zone ${toZone} policy ${name}`,
      explanation: `Remove migrated policy "${name}" from ${fromZone}→${toZone} zone pair`,
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
