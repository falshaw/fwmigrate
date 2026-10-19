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

export class CheckPointGenerator implements IConfigGenerator {
  vendor: FirewallVendor = "CHECKPOINT";

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult> {
    const warnings: string[] = [];
    const objectsCreated: string[] = [];
    const ruleConfigs: RuleConfig[] = [];

    // Generate mgmt_cli commands
    const configLines: string[] = [
      "# Check Point R80+ Management API Commands",
      "",
    ];

    // Objects
    for (const obj of objects) {
      if (obj.objectType === "address" && obj.members.length > 0) {
        const member = obj.members[0];
        if (member.endsWith("/32")) {
          configLines.push(
            `mgmt_cli add host name "${obj.name}" ip-address "${member.replace("/32", "")}"`,
          );
        } else if (member.includes("/")) {
          const [ip, mask] = member.split("/");
          configLines.push(
            `mgmt_cli add network name "${obj.name}" subnet "${ip}" mask-length "${mask}"`,
          );
        }
        objectsCreated.push(obj.name);
      } else if (obj.objectType === "address-group") {
        configLines.push(
          `mgmt_cli add group name "${obj.name}" members.1 "${obj.members[0] || ""}"`,
        );
        objectsCreated.push(obj.name);
      }
    }

    configLines.push("");
    configLines.push("# Access Rules");

    for (const rule of rules) {
      const config = this.generateRule(rule, zoneMappings);
      configLines.push(config);
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config,
        explanation: `Rule ${rule.position}: ${rule.action} from ${rule.sources.join(",")} to ${rule.destinations.join(",")}`,
        warnings: [],
      });
    }

    configLines.push("", "mgmt_cli publish");

    return {
      config: configLines.join("\n"),
      ruleConfigs,
      warnings,
      objectsCreated,
    };
  }

  generateRule(rule: NormalizedRule, _zoneMappings: ZoneMapping[]): string {
    const action =
      rule.action === "permit"
        ? "Accept"
        : rule.action === "drop"
          ? "Drop"
          : "Reject";
    const parts = [
      `mgmt_cli add access-rule`,
      `layer "Network"`,
      `name "${rule.name}"`,
      `position ${rule.position}`,
      `source.1 "${rule.sources[0] || "Any"}"`,
      `destination.1 "${rule.destinations[0] || "Any"}"`,
      `service.1 "${rule.services[0] || "Any"}"`,
      `action "${action}"`,
    ];
    if (rule.logging) parts.push('track "Log"');
    if (rule.description) parts.push(`comments "${rule.description}"`);
    return parts.join(" \\\n  ");
  }

  generateRollback(
    rule: NormalizedRule,
    _zoneMappings: ZoneMapping[],
  ): RollbackCommand {
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `mgmt_cli delete access-rule layer "Network" name "${rule.name}"`,
      explanation: `Remove migrated rule "${rule.name}" from CheckPoint policy`,
    };
  }
}
