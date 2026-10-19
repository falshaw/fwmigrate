/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * SonicWall SonicOS config parser
 * Parses SonicWall CLI/exported config format
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

export class SonicWallParser implements IConfigParser {
  vendor: FirewallVendor = "SONICWALL";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const hasMarkers = lines.some(
      (l) =>
        l.includes("access-rule") ||
        l.includes("address-object") ||
        l.includes("SonicWall") ||
        l.includes("sonicwall") ||
        l.match(/^zone\s+/) ||
        l.includes("service-object"),
    );
    if (!hasMarkers)
      errors.push("Config does not appear to be SonicWall SonicOS format");
    return {
      valid: errors.length === 0,
      vendor: "SONICWALL",
      configType: "text",
      errors,
      lineCount: lines.length,
    };
  }

  async parse(rawConfig: string): Promise<ParseResult> {
    const log: ParseLogEntry[] = [];
    const lines = rawConfig.split("\n").map((l) => l.trimEnd());
    log.push({
      level: "info",
      message: `Parsing ${lines.length} lines of SonicWall config`,
    });

    const objects = this.parseAddressObjects(lines, log);
    const rules = this.parseAccessRules(lines, log);
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

  private parseAccessRules(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    let position = 1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // SonicWall access-rule format: access-rule from <zone> to <zone> ...
      const ruleMatch = trimmed.match(
        /^access-rule\s+(?:from\s+(\S+)\s+to\s+(\S+))?/,
      );
      if (ruleMatch) {
        const fields: Record<string, string> = {};
        fields.srcZone = ruleMatch[1] || "";
        fields.dstZone = ruleMatch[2] || "";

        // Read continuation lines (indented or key-value pairs)
        while (i + 1 < lines.length && lines[i + 1].match(/^\s{2,}/)) {
          i++;
          const kvMatch = lines[i].trim().match(/^(\S+)\s+(.+)$/);
          if (kvMatch) fields[kvMatch[1]] = kvMatch[2];
        }

        rules.push({
          name: fields.name || `sw-rule-${position}`,
          position,
          enabled: fields.enable !== "no",
          action: fields.action === "deny" ? "deny" : "permit",
          sources: fields.source
            ? fields.source.split(/\s+/).filter(Boolean)
            : ["any"],
          destinations: fields.destination
            ? fields.destination.split(/\s+/).filter(Boolean)
            : ["any"],
          services: fields.service
            ? fields.service.split(/\s+/).filter(Boolean)
            : ["any"],
          sourceZone: fields.srcZone,
          destinationZone: fields.dstZone,
          description: fields.comment,
          logging: fields.logging !== "no",
          rawVendorData: { ...fields },
        });
        position++;
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} access rules`,
    });
    return rules;
  }

  private parseAddressObjects(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const addrMatch = trimmed.match(/^address-object\s+(?:ipv4\s+)?(\S+)/);
      if (addrMatch) {
        const name = addrMatch[1];
        const members: string[] = [];

        while (i + 1 < lines.length && lines[i + 1].match(/^\s{2,}/)) {
          i++;
          const kvMatch = lines[i].trim().match(/^(\S+)\s+(.+)$/);
          if (kvMatch) {
            if (kvMatch[1] === "host" || kvMatch[1] === "network")
              members.push(kvMatch[2]);
            if (kvMatch[1] === "range") members.push(kvMatch[2]);
          }
        }

        objects.push({ objectType: "address", name, members });
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${objects.length} address objects`,
    });
    return objects;
  }

  private parseInterfaces(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    const interfaces: NormalizedInterface[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const ifMatch = trimmed.match(/^interface\s+(\S+)/);
      if (ifMatch) {
        const fields: Record<string, string> = { name: ifMatch[1] };
        while (i + 1 < lines.length && lines[i + 1].match(/^\s{2,}/)) {
          i++;
          const kvMatch = lines[i].trim().match(/^(\S+)\s+(.+)$/);
          if (kvMatch) fields[kvMatch[1]] = kvMatch[2];
        }
        interfaces.push({
          name: fields.name,
          ip: fields.ip,
          mask: fields.mask,
          zone: fields.zone,
          enabled: fields.shutdown !== "yes",
        });
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${interfaces.length} interfaces`,
    });
    return interfaces;
  }
}
