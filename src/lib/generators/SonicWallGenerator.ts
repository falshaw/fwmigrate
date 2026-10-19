/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * SonicWall SonicOS config generator
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

export class SonicWallGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "SONICWALL";

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
    for (const obj of objects) {
      if (obj.objectType === "address" && obj.members.length > 0) {
        const member = obj.members[0];
        if (member.includes("/")) {
          configLines.push(`address-object ipv4 ${obj.name}`);
          configLines.push(`  network ${member}`);
        } else {
          configLines.push(`address-object ipv4 ${obj.name}`);
          configLines.push(`  host ${member}`);
        }
        objectsCreated.push(obj.name);
      }
    }

    configLines.push("");

    // Access rules
    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `Rule ${rule.position}: ${rule.action} from ${rule.sourceZone || "any"} to ${rule.destinationZone || "any"}`,
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
    const srcZone = this.mapZone(rule.sourceZone, zoneMappings) || "LAN";
    const dstZone = this.mapZone(rule.destinationZone, zoneMappings) || "WAN";
    const action = rule.action === "permit" ? "allow" : "deny";
    const lines: string[] = [];

    lines.push(`access-rule from ${srcZone} to ${dstZone}`);
    lines.push(`  name ${rule.name}`);
    lines.push(`  action ${action}`);
    lines.push(`  source ${rule.sources.join(" ")}`);
    lines.push(`  destination ${rule.destinations.join(" ")}`);
    lines.push(`  service ${rule.services.join(" ")}`);
    if (!rule.enabled) lines.push("  enable no");
    if (rule.logging) lines.push("  logging yes");
    if (rule.description) lines.push(`  comment ${rule.description}`);

    return lines.join("\n");
  }

  generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    const srcZone = this.mapZone(rule.sourceZone, zoneMappings) || "LAN";
    const dstZone = this.mapZone(rule.destinationZone, zoneMappings) || "WAN";
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `no access-rule from ${srcZone} to ${dstZone} name ${rule.name}`,
      explanation: `Remove migrated access-rule "${rule.name}" from SonicWall`,
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
