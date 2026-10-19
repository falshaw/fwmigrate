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

export class PaloAltoGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "PALO_ALTO";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];
    const configLines: string[] = [];

    // Generate address objects first
    configLines.push("# Address Objects");
    for (const obj of objects) {
      if (obj.objectType === "address") {
        for (const member of obj.members) {
          configLines.push(`set address "${obj.name}" ip-netmask ${member}`);
          objectsCreated.push(obj.name);
        }
      } else if (obj.objectType === "address-group") {
        const members = obj.members.map((m) => `"${m}"`).join(" ");
        configLines.push(
          `set address-group "${obj.name}" static [ ${members} ]`,
        );
        objectsCreated.push(obj.name);
      }
    }

    configLines.push("");
    configLines.push("# Security Rules");

    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);

      const ruleWarnings: string[] = [];
      if (rule.sources.includes("any") && rule.destinations.includes("any")) {
        ruleWarnings.push(
          "Rule has any-any source/destination — review for overly permissive access",
        );
      }
      if (rule.services.includes("any")) {
        ruleWarnings.push(
          "Rule allows all services — consider restricting to specific applications",
        );
      }

      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `${rule.action === "permit" ? "Allow" : "Deny"} traffic from ${rule.sources.join(",")} to ${rule.destinations.join(",")} on ${rule.services.join(",")}`,
        warnings: ruleWarnings,
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
    const name = this.sanitizeName(rule.name);
    const fromZone = this.mapZone(rule.sourceZone, zoneMappings) || "any";
    const toZone = this.mapZone(rule.destinationZone, zoneMappings) || "any";
    const action =
      rule.action === "permit"
        ? "allow"
        : rule.action === "drop"
          ? "drop"
          : "deny";

    const lines: string[] = [];
    lines.push(`set rulebase security rules "${name}" from "${fromZone}"`);
    lines.push(`set rulebase security rules "${name}" to "${toZone}"`);
    lines.push(
      `set rulebase security rules "${name}" source [ ${rule.sources.map((s) => `"${s}"`).join(" ")} ]`,
    );
    lines.push(
      `set rulebase security rules "${name}" destination [ ${rule.destinations.map((d) => `"${d}"`).join(" ")} ]`,
    );
    lines.push(
      `set rulebase security rules "${name}" service [ ${rule.services.map((s) => `"${s}"`).join(" ")} ]`,
    );
    lines.push(`set rulebase security rules "${name}" application [ "any" ]`);
    lines.push(`set rulebase security rules "${name}" action ${action}`);
    if (rule.description)
      lines.push(
        `set rulebase security rules "${name}" description "${rule.description}"`,
      );
    if (rule.logging)
      lines.push(`set rulebase security rules "${name}" log-end yes`);
    if (!rule.enabled)
      lines.push(`set rulebase security rules "${name}" disabled yes`);

    return lines.join("\n");
  }

  generateRollback(
    rule: NormalizedRule,
    _zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    const name = this.sanitizeName(rule.name);
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `delete rulebase security rules "${name}"`,
      explanation: `Remove migrated rule "${name}" from Palo Alto security rulebase`,
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

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 63);
  }
}
