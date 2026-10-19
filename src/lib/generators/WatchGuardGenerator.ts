/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * WatchGuard Firebox config generator
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

export class WatchGuardGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "WATCHGUARD";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = [];

    configLines.push("<configuration>");

    // Alias list
    configLines.push("  <alias-list>");
    for (const obj of objects) {
      if (obj.members.length > 0) {
        configLines.push(`    <alias name="${obj.name}">`);
        for (const member of obj.members) {
          configLines.push(`      <member>${member}</member>`);
        }
        configLines.push("    </alias>");
        objectsCreated.push(obj.name);
      }
    }
    configLines.push("  </alias-list>");

    // Policy list
    configLines.push("  <policy-list>");
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
    configLines.push("  </policy-list>");

    configLines.push("</configuration>");

    return {
      config: configLines.join("\n"),
      ruleConfigs,
      warnings,
      objectsCreated,
    };
  }

  generateRule(rule: NormalizedRule, zoneMappings: ZoneMapping[]): string {
    const srcZone = this.mapZone(rule.sourceZone, zoneMappings) || "Trusted";
    const dstZone =
      this.mapZone(rule.destinationZone, zoneMappings) || "External";
    const action = rule.action === "permit" ? "allow" : "deny";
    const lines: string[] = [];

    lines.push(`    <policy name="${rule.name}" enabled="${rule.enabled}">`);
    lines.push(`      <action>${action}</action>`);
    lines.push(`      <from>${rule.sources.join(",")}</from>`);
    lines.push(`      <to>${rule.destinations.join(",")}</to>`);
    lines.push(`      <service>${rule.services.join(",")}</service>`);
    lines.push(`      <fromZone>${srcZone}</fromZone>`);
    lines.push(`      <toZone>${dstZone}</toZone>`);
    lines.push(`      <log>${rule.logging}</log>`);
    if (rule.description)
      lines.push(`      <description>${rule.description}</description>`);
    lines.push("    </policy>");

    return lines.join("\n");
  }

  generateRollback(
    rule: NormalizedRule,
    _zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `Remove policy "${rule.name}" from WatchGuard policy-list`,
      explanation: `Delete migrated policy "${rule.name}" from WatchGuard Firebox`,
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
