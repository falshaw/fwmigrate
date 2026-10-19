/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Sophos XG/SFOS config parser
 * Parses XML-based export format from Sophos Firewall
 */

import type { IConfigParser } from "./ParserInterface";
import type {
  FirewallVendor,
  ParseResult,
  ValidationResult,
  NormalizedRule,
  NormalizedObject,
  NormalizedInterface,
  ParseLogEntry,
} from "./types";

export class SophosParser implements IConfigParser {
  vendor: FirewallVendor = "SOPHOS";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const hasSophosMarkers = lines.some(
      (l) =>
        l.includes("<FirewallRule") ||
        l.includes("<IPHost") ||
        l.includes("<!DOCTYPE") ||
        l.includes("<Configuration") ||
        l.includes("Sophos"),
    );
    if (!hasSophosMarkers)
      errors.push("Config does not appear to be Sophos XG/SFOS format");
    return {
      valid: errors.length === 0,
      vendor: "SOPHOS",
      configType: "xml",
      errors,
      lineCount: lines.length,
    };
  }

  async parse(rawConfig: string): Promise<ParseResult> {
    const log: ParseLogEntry[] = [];
    const lines = rawConfig.split("\n").map((l) => l.trimEnd());
    log.push({
      level: "info",
      message: `Parsing ${lines.length} lines of Sophos config`,
    });

    const objects = this.parseHosts(lines, log);
    const rules = this.parseFirewallRules(lines, log);
    const interfaces = this.parseInterfaces(lines, log);

    return {
      rules,
      objects,
      natRules: [],
      interfaces,
      routes: [],
      parseLog: log,
      confidence: rules.length > 0 ? 0.85 : 0.4,
      warnings: log.filter((e) => e.level === "warn").map((e) => e.message),
    };
  }

  private parseFirewallRules(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    let inRule = false;
    let ruleFields: Record<string, string> = {};
    let position = 1;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.includes("<FirewallRule")) {
        inRule = true;
        ruleFields = {};
        continue;
      }
      if (trimmed.includes("</FirewallRule")) {
        if (inRule) {
          rules.push({
            name: ruleFields.Name || `sophos-rule-${position}`,
            position,
            enabled: ruleFields.Status !== "Disable",
            action: ruleFields.Action === "Accept" ? "permit" : "deny",
            sources: this.parseList(ruleFields.SourceNetworks),
            destinations: this.parseList(ruleFields.DestinationNetworks),
            services: this.parseList(ruleFields.Services || ruleFields.Service),
            sourceZone: ruleFields.SourceZones,
            destinationZone: ruleFields.DestinationZones,
            description: ruleFields.Description,
            logging: ruleFields.LogTraffic !== "Disable",
            rawVendorData: { ...ruleFields },
          });
          position++;
        }
        inRule = false;
        continue;
      }

      if (inRule) {
        const tagMatch = trimmed.match(/<(\w+)>(.*?)<\/\1>/);
        if (tagMatch) {
          ruleFields[tagMatch[1]] = tagMatch[2];
        }
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} firewall rules`,
    });
    return rules;
  }

  private parseHosts(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];
    let inHost = false;
    let hostFields: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.includes("<IPHost")) {
        inHost = true;
        hostFields = {};
        continue;
      }
      if (trimmed.includes("</IPHost")) {
        if (inHost && hostFields.Name) {
          const members: string[] = [];
          if (hostFields.IPAddress) members.push(hostFields.IPAddress);
          if (hostFields.Subnet)
            members.push(
              `${hostFields.IPAddress || "0.0.0.0"}/${hostFields.Subnet}`,
            );
          objects.push({
            objectType: "address",
            name: hostFields.Name,
            members,
          });
        }
        inHost = false;
        continue;
      }

      if (inHost) {
        const tagMatch = trimmed.match(/<(\w+)>(.*?)<\/\1>/);
        if (tagMatch) hostFields[tagMatch[1]] = tagMatch[2];
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${objects.length} host objects`,
    });
    return objects;
  }

  private parseInterfaces(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    const interfaces: NormalizedInterface[] = [];
    let inIface = false;
    let ifaceFields: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes("<Interface")) {
        inIface = true;
        ifaceFields = {};
        continue;
      }
      if (trimmed.includes("</Interface")) {
        if (inIface && ifaceFields.Name) {
          interfaces.push({
            name: ifaceFields.Name,
            ip: ifaceFields.IPAddress,
            mask: ifaceFields.Netmask,
            zone: ifaceFields.Zone,
            enabled: ifaceFields.Status !== "Disable",
          });
        }
        inIface = false;
        continue;
      }
      if (inIface) {
        const tagMatch = trimmed.match(/<(\w+)>(.*?)<\/\1>/);
        if (tagMatch) ifaceFields[tagMatch[1]] = tagMatch[2];
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${interfaces.length} interfaces`,
    });
    return interfaces;
  }

  private parseList(value: string | undefined): string[] {
    if (!value) return ["any"];
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
