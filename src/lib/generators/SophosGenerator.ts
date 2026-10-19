/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Sophos XG/SFOS config generator
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

export class SophosGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "SOPHOS";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = [];

    configLines.push('<?xml version="1.0" encoding="UTF-8"?>');
    configLines.push("<Configuration>");

    // IP Hosts
    for (const obj of objects) {
      if (obj.objectType === "address" && obj.members.length > 0) {
        configLines.push("  <IPHost>");
        configLines.push(`    <Name>${obj.name}</Name>`);
        configLines.push(`    <IPAddress>${obj.members[0]}</IPAddress>`);
        configLines.push("  </IPHost>");
        objectsCreated.push(obj.name);
      }
    }

    // Firewall Rules
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

    configLines.push("</Configuration>");

    return {
      config: configLines.join("\n"),
      ruleConfigs,
      warnings,
      objectsCreated,
    };
  }

  generateRule(rule: NormalizedRule, zoneMappings: ZoneMapping[]): string {
    const srcZone = this.mapZone(rule.sourceZone, zoneMappings) || "Any";
    const dstZone = this.mapZone(rule.destinationZone, zoneMappings) || "Any";
    const action = rule.action === "permit" ? "Accept" : "Drop";
    const lines: string[] = [];

    lines.push("  <FirewallRule>");
    lines.push(`    <Name>${rule.name}</Name>`);
    lines.push(`    <Position>${rule.position}</Position>`);
    lines.push(`    <Status>${rule.enabled ? "Enable" : "Disable"}</Status>`);
    lines.push(`    <Action>${action}</Action>`);
    lines.push(`    <SourceZones>${srcZone}</SourceZones>`);
    lines.push(`    <DestinationZones>${dstZone}</DestinationZones>`);
    lines.push(
      `    <SourceNetworks>${rule.sources.join(",")}</SourceNetworks>`,
    );
    lines.push(
      `    <DestinationNetworks>${rule.destinations.join(",")}</DestinationNetworks>`,
    );
    lines.push(`    <Services>${rule.services.join(",")}</Services>`);
    lines.push(
      `    <LogTraffic>${rule.logging ? "Enable" : "Disable"}</LogTraffic>`,
    );
    if (rule.description)
      lines.push(`    <Description>${rule.description}</Description>`);
    lines.push("  </FirewallRule>");

    return lines.join("\n");
  }

  generateRollback(
    rule: NormalizedRule,
    _zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `Delete FirewallRule "${rule.name}" (position ${rule.position})`,
      explanation: `Remove migrated rule "${rule.name}" from Sophos XG`,
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
