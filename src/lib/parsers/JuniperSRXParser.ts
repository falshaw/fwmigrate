/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Juniper SRX parser — `set security` command format
 */

import type { IConfigParser } from "./ParserInterface";
import type {
  FirewallVendor,
  ParseResult,
  ValidationResult,
  NormalizedRule,
  NormalizedObject,
  ParseLogEntry,
} from "./types";

export class JuniperSRXParser implements IConfigParser {
  vendor: FirewallVendor = "JUNIPER_SRX";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const hasJunosMarkers = lines.some(
      (l) =>
        l.includes("set security policies") ||
        l.includes("set security zones") ||
        l.includes("set security address-book"),
    );
    if (!hasJunosMarkers)
      errors.push("Config does not appear to be Juniper SRX set commands");
    return {
      valid: errors.length === 0,
      vendor: "JUNIPER_SRX",
      configType: "set",
      errors,
      lineCount: lines.length,
    };
  }

  async parse(rawConfig: string): Promise<ParseResult> {
    const log: ParseLogEntry[] = [];
    const lines = rawConfig
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("set "));
    log.push({
      level: "info",
      message: `Parsing ${lines.length} Juniper SRX set commands`,
    });

    const rules = this.parsePolicies(lines, log);
    const objects = this.parseAddressBooks(lines, log);

    return {
      rules,
      objects,
      natRules: [],
      interfaces: [],
      routes: [],
      parseLog: log,
      confidence: rules.length > 0 ? 0.9 : 0.5,
      warnings: log.filter((e) => e.level === "warn").map((e) => e.message),
    };
  }

  private parsePolicies(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    // set security policies from-zone <src> to-zone <dst> policy <name> match <field> <value>
    // set security policies from-zone <src> to-zone <dst> policy <name> then <action>
    const ruleData = new Map<
      string,
      {
        name: string;
        srcZone: string;
        dstZone: string;
        sources: string[];
        destinations: string[];
        services: string[];
        action: string;
        description?: string;
      }
    >();

    for (const line of lines) {
      const policyMatch = line.match(
        /^set security policies from-zone (\S+) to-zone (\S+) policy (\S+) (.+)$/,
      );
      if (!policyMatch) continue;

      const [, srcZone, dstZone, policyName, rest] = policyMatch;
      const key = `${srcZone}:${dstZone}:${policyName}`;

      if (!ruleData.has(key)) {
        ruleData.set(key, {
          name: policyName,
          srcZone,
          dstZone,
          sources: [],
          destinations: [],
          services: [],
          action: "permit",
        });
      }
      const rule = ruleData.get(key)!;

      if (rest.startsWith("match source-address ")) {
        rule.sources.push(rest.replace("match source-address ", ""));
      } else if (rest.startsWith("match destination-address ")) {
        rule.destinations.push(rest.replace("match destination-address ", ""));
      } else if (rest.startsWith("match application ")) {
        rule.services.push(rest.replace("match application ", ""));
      } else if (rest.startsWith("then ")) {
        const action = rest.replace("then ", "").split(/\s/)[0];
        rule.action =
          action === "permit" ? "permit" : action === "deny" ? "deny" : "drop";
      } else if (rest.startsWith("description ")) {
        rule.description = rest
          .replace("description ", "")
          .replace(/^"(.*)"$/, "$1");
      }
    }

    const rules: NormalizedRule[] = [];
    let pos = 0;
    for (const [, data] of ruleData) {
      pos++;
      rules.push({
        name: data.name,
        position: pos,
        enabled: true,
        action: data.action as NormalizedRule["action"],
        sources: data.sources.length > 0 ? data.sources : ["any"],
        destinations:
          data.destinations.length > 0 ? data.destinations : ["any"],
        services: data.services.length > 0 ? data.services : ["any"],
        sourceZone: data.srcZone,
        destinationZone: data.dstZone,
        description: data.description,
        logging: false,
      });
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} security policies`,
    });
    return rules;
  }

  private parseAddressBooks(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];
    const addressData = new Map<string, string[]>();
    const groupData = new Map<string, string[]>();

    for (const line of lines) {
      // set security zones security-zone <zone> address-book address <name> <ip/prefix>
      const addrMatch = line.match(
        /^set security zones security-zone \S+ address-book address (\S+) (\S+)$/,
      );
      if (addrMatch) {
        addressData.set(addrMatch[1], [addrMatch[2]]);
        continue;
      }

      // Global address book
      const globalAddrMatch = line.match(
        /^set security address-book global address (\S+) (\S+)$/,
      );
      if (globalAddrMatch) {
        addressData.set(globalAddrMatch[1], [globalAddrMatch[2]]);
        continue;
      }

      // Address sets
      const setMatch = line.match(
        /^set security address-book global address-set (\S+) address (\S+)$/,
      );
      if (setMatch) {
        if (!groupData.has(setMatch[1])) groupData.set(setMatch[1], []);
        groupData.get(setMatch[1])!.push(setMatch[2]);
      }
    }

    for (const [name, members] of addressData) {
      objects.push({ objectType: "address", name, members });
    }
    for (const [name, members] of groupData) {
      objects.push({ objectType: "address-group", name, members });
    }

    log.push({
      level: "info",
      message: `Parsed ${objects.length} address objects`,
    });
    return objects;
  }
}
