/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * WatchGuard Firebox config parser
 * Parses WatchGuard XML-based configuration export
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

export class WatchGuardParser implements IConfigParser {
  vendor: FirewallVendor = "WATCHGUARD";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const hasMarkers = lines.some(
      (l) =>
        l.includes("<policy-list") ||
        l.includes("<alias-list") ||
        l.includes("<interface-list") ||
        l.includes("WatchGuard") ||
        l.includes("<profile>"),
    );
    if (!hasMarkers)
      errors.push("Config does not appear to be WatchGuard Firebox format");
    return {
      valid: errors.length === 0,
      vendor: "WATCHGUARD",
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
      message: `Parsing ${lines.length} lines of WatchGuard config`,
    });

    const objects = this.parseAliases(lines, log);
    const rules = this.parsePolicies(lines, log);
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

  private parsePolicies(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    let inPolicy = false;
    let fields: Record<string, string> = {};
    let position = 1;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.includes("<policy") && !trimmed.includes("</policy")) {
        inPolicy = true;
        fields = {};
        const nameMatch = trimmed.match(/name="([^"]+)"/);
        if (nameMatch) fields.name = nameMatch[1];
        continue;
      }
      if (trimmed.includes("</policy")) {
        if (inPolicy) {
          rules.push({
            name: fields.name || `wg-policy-${position}`,
            position,
            enabled: fields.enabled !== "false",
            action:
              fields.action === "deny" || fields.action === "drop"
                ? "deny"
                : "permit",
            sources: this.parseList(fields.from),
            destinations: this.parseList(fields.to),
            services: this.parseList(fields.service),
            sourceZone: fields.fromZone,
            destinationZone: fields.toZone,
            description: fields.description,
            logging: fields.log !== "false",
            rawVendorData: { ...fields },
          });
          position++;
        }
        inPolicy = false;
        continue;
      }

      if (inPolicy) {
        const tagMatch = trimmed.match(/<(\w[\w-]*)>(.*?)<\/\1>/);
        if (tagMatch) fields[tagMatch[1]] = tagMatch[2];
        const attrMatch = trimmed.match(/(\w+)="([^"]+)"/g);
        if (attrMatch) {
          for (const attr of attrMatch) {
            const [key, val] = attr.split("=");
            fields[key] = val.replace(/"/g, "");
          }
        }
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} policies`,
    });
    return rules;
  }

  private parseAliases(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];
    let inAlias = false;
    let aliasName = "";
    let members: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes("<alias")) {
        const nameMatch = trimmed.match(/name="([^"]+)"/);
        if (nameMatch) {
          inAlias = true;
          aliasName = nameMatch[1];
          members = [];
        }
        continue;
      }
      if (trimmed.includes("</alias")) {
        if (inAlias && aliasName) {
          objects.push({
            objectType: members.length > 1 ? "address-group" : "address",
            name: aliasName,
            members,
          });
        }
        inAlias = false;
        continue;
      }
      if (inAlias) {
        const memberMatch = trimmed.match(/<member>(.*?)<\/member>/);
        if (memberMatch) members.push(memberMatch[1]);
        const ipMatch = trimmed.match(/<host-ip>(.*?)<\/host-ip>/);
        if (ipMatch) members.push(ipMatch[1]);
        const netMatch = trimmed.match(/<network-ip>(.*?)<\/network-ip>/);
        if (netMatch) members.push(netMatch[1]);
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${objects.length} alias objects`,
    });
    return objects;
  }

  private parseInterfaces(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    const interfaces: NormalizedInterface[] = [];
    let inIface = false;
    let fields: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes("<interface") && !trimmed.includes("</interface")) {
        inIface = true;
        fields = {};
        const nameMatch = trimmed.match(/name="([^"]+)"/);
        if (nameMatch) fields.name = nameMatch[1];
        continue;
      }
      if (trimmed.includes("</interface")) {
        if (inIface && fields.name) {
          interfaces.push({
            name: fields.name,
            ip: fields.ip,
            mask: fields.netmask,
            zone: fields.zone,
            enabled: fields.enabled !== "false",
          });
        }
        inIface = false;
        continue;
      }
      if (inIface) {
        const tagMatch = trimmed.match(/<(\w[\w-]*)>(.*?)<\/\1>/);
        if (tagMatch) fields[tagMatch[1]] = tagMatch[2];
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
