/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * pfSense config parser
 * Parses pfSense XML configuration export (config.xml)
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

export class PfSenseParser implements IConfigParser {
  vendor: FirewallVendor = "PFSENSE";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const hasMarkers = lines.some(
      (l) =>
        l.includes("<pfsense>") ||
        l.includes("<filter>") ||
        l.includes("<rule>") ||
        l.includes("<interfaces>") ||
        l.includes("pfSense"),
    );
    if (!hasMarkers)
      errors.push("Config does not appear to be pfSense XML format");
    return {
      valid: errors.length === 0,
      vendor: "PFSENSE",
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
      message: `Parsing ${lines.length} lines of pfSense config`,
    });

    const objects = this.parseAliases(lines, log);
    const rules = this.parseFilterRules(lines, log);
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

  private parseFilterRules(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    let inFilter = false;
    let inRule = false;
    let fields: Record<string, string> = {};
    let position = 1;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "<filter>") {
        inFilter = true;
        continue;
      }
      if (trimmed === "</filter>") {
        inFilter = false;
        continue;
      }

      if (inFilter && trimmed === "<rule>") {
        inRule = true;
        fields = {};
        continue;
      }
      if (inFilter && trimmed === "</rule>") {
        if (inRule) {
          // pfSense: no explicit action = pass, "block" or "reject" = deny
          const action =
            fields.type === "block" || fields.type === "reject"
              ? "deny"
              : "permit";

          rules.push({
            name: fields.descr || `pf-rule-${position}`,
            position,
            enabled: fields.disabled !== "1" && !fields.disabled,
            action,
            sources: [fields.source || "any"],
            destinations: [fields.destination || "any"],
            services: this.parseService(fields.protocol, fields.dstport),
            sourceZone: fields.interface,
            description: fields.descr,
            logging: fields.log === "1" || !!fields.log,
            rawVendorData: { ...fields },
          });
          position++;
        }
        inRule = false;
        continue;
      }

      if (inRule) {
        // Handle simple tags
        const tagMatch = trimmed.match(/<(\w+)>(.*?)<\/\1>/);
        if (tagMatch) {
          fields[tagMatch[1]] = tagMatch[2];
        }
        // Handle nested source/destination with <address> or <network>
        const addrMatch = trimmed.match(/<address>(.*?)<\/address>/);
        if (addrMatch) {
          // Check if previous line was <source> or <destination>
          const parent = this.findParent(lines, lines.indexOf(line));
          if (parent === "source") fields.source = addrMatch[1];
          if (parent === "destination") fields.destination = addrMatch[1];
        }
        const netMatch = trimmed.match(/<network>(.*?)<\/network>/);
        if (netMatch) {
          const parent = this.findParent(lines, lines.indexOf(line));
          if (parent === "source") fields.source = netMatch[1];
          if (parent === "destination") fields.destination = netMatch[1];
        }
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} filter rules`,
    });
    return rules;
  }

  private parseAliases(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];
    let inAlias = false;
    let fields: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "<alias>") {
        inAlias = true;
        fields = {};
        continue;
      }
      if (trimmed === "</alias>") {
        if (inAlias && fields.name) {
          const members = fields.address
            ? fields.address.split(/\s+/).filter(Boolean)
            : [];
          objects.push({
            objectType: fields.type === "host" ? "address" : "address-group",
            name: fields.name,
            members,
          });
        }
        inAlias = false;
        continue;
      }
      if (inAlias) {
        const tagMatch = trimmed.match(/<(\w+)>(.*?)<\/\1>/);
        if (tagMatch) fields[tagMatch[1]] = tagMatch[2];
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${objects.length} aliases`,
    });
    return objects;
  }

  private parseInterfaces(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    const interfaces: NormalizedInterface[] = [];
    let inInterfaces = false;
    let currentIface = "";
    let fields: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "<interfaces>") {
        inInterfaces = true;
        continue;
      }
      if (trimmed === "</interfaces>") {
        inInterfaces = false;
        continue;
      }

      if (inInterfaces) {
        const ifOpenMatch = trimmed.match(/^<(\w+)>$/);
        const ifCloseMatch = trimmed.match(/^<\/(\w+)>$/);
        if (
          ifOpenMatch &&
          !["enable", "if", "descr", "ipaddr", "subnet"].includes(
            ifOpenMatch[1],
          )
        ) {
          currentIface = ifOpenMatch[1];
          fields = {};
          continue;
        }
        if (ifCloseMatch && ifCloseMatch[1] === currentIface) {
          if (currentIface) {
            interfaces.push({
              name: fields.if || currentIface,
              ip: fields.ipaddr,
              mask: fields.subnet ? `/${fields.subnet}` : undefined,
              zone: currentIface.toUpperCase(),
              enabled: fields.enable !== "0",
            });
          }
          currentIface = "";
          continue;
        }
        if (currentIface) {
          const tagMatch = trimmed.match(/<(\w+)>(.*?)<\/\1>/);
          if (tagMatch) fields[tagMatch[1]] = tagMatch[2];
        }
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${interfaces.length} interfaces`,
    });
    return interfaces;
  }

  private parseService(
    protocol: string | undefined,
    port: string | undefined,
  ): string[] {
    if (!protocol) return ["any"];
    if (port) return [`${protocol}/${port}`];
    return [protocol];
  }

  private findParent(lines: string[], idx: number): string {
    for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
      const t = lines[i].trim();
      if (t === "<source>") return "source";
      if (t === "<destination>") return "destination";
      if (t === "</source>" || t === "</destination>") break;
    }
    return "";
  }
}
