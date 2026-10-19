/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * MikroTik RouterOS config generator
 * Generates RouterOS CLI commands
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

export class MikroTikGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "MIKROTIK";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = [];

    // Address lists
    if (objects.length > 0) {
      configLines.push("/ip firewall address-list");
      for (const obj of objects) {
        for (const member of obj.members) {
          configLines.push(`add list=${obj.name} address=${member}`);
        }
        objectsCreated.push(obj.name);
      }
      configLines.push("");
    }

    // Firewall filter rules
    configLines.push("/ip firewall filter");
    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `Rule ${rule.position}: ${rule.action} ${rule.sourceZone || "any"} → ${rule.destinationZone || "any"}`,
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
    const action = rule.action === "permit" ? "accept" : "drop";
    const parts: string[] = [`add chain=forward action=${action}`];

    const srcIface = this.mapZone(rule.sourceZone, zoneMappings);
    const dstIface = this.mapZone(rule.destinationZone, zoneMappings);

    if (srcIface) parts.push(`in-interface=${srcIface}`);
    if (dstIface) parts.push(`out-interface=${dstIface}`);

    const src = rule.sources[0];
    if (src && src !== "any") parts.push(`src-address=${src}`);

    const dst = rule.destinations[0];
    if (dst && dst !== "any") parts.push(`dst-address=${dst}`);

    // Service parsing
    const svc = rule.services[0];
    if (svc && svc !== "any") {
      const [proto, port] = svc.split("/");
      parts.push(`protocol=${proto}`);
      if (port) parts.push(`dst-port=${port}`);
    }

    if (!rule.enabled) parts.push("disabled=yes");
    if (rule.logging) parts.push("log=yes");
    if (rule.description) parts.push(`comment="${rule.description}"`);

    return parts.join(" ");
  }

  generateRollback(
    rule: NormalizedRule,
    _zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    const findCriteria: string[] = [];
    if (rule.description) findCriteria.push(`comment="${rule.description}"`);
    else findCriteria.push(`comment="${rule.name}"`);

    return {
      position: rule.position,
      ruleName: rule.name,
      command: `/ip firewall filter remove [find ${findCriteria.join(" ")}]`,
      explanation: `Remove migrated filter rule "${rule.name}" from MikroTik`,
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
