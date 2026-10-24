/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Palo Alto Networks config parser
 * Supports both XML export and `set` command format
 */

import { XMLParser } from "fast-xml-parser";
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

export class PaloAltoParser implements IConfigParser {
  vendor: FirewallVendor = "PALO_ALTO";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const isXML =
      rawConfig.trim().startsWith("<") &&
      (rawConfig.includes("<config") || rawConfig.includes("<entry"));
    const isSet = lines.some((l) => l.trim().startsWith("set "));

    if (!isXML && !isSet)
      errors.push("Config is neither PA XML export nor set commands");

    return {
      valid: errors.length === 0,
      vendor: "PALO_ALTO",
      configType: isXML ? "xml" : "set",
      errors,
      lineCount: lines.length,
    };
  }

  async parse(rawConfig: string): Promise<ParseResult> {
    const isXML = rawConfig.trim().startsWith("<");
    return isXML ? this.parseXML(rawConfig) : this.parseSetCommands(rawConfig);
  }

  private parseXML(rawConfig: string): ParseResult {
    const log: ParseLogEntry[] = [];
    log.push({ level: "info", message: "Parsing Palo Alto XML config" });

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) => ["entry", "member"].includes(name),
    });

    const xml = parser.parse(rawConfig);
    const config = xml.config || xml.response?.result?.config || xml;

    const rules = this.parseXMLRules(config, log);
    const objects = this.parseXMLObjects(config, log);
    const interfaces = this.parseXMLInterfaces(config, log);

    return {
      rules,
      objects,
      natRules: [],
      interfaces,
      routes: [],
      parseLog: log,
      confidence: rules.length > 0 ? 0.95 : 0.5,
      warnings: log.filter((e) => e.level === "warn").map((e) => e.message),
    };
  }

  private parseXMLRules(
    config: Record<string, unknown>,
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    const rulebase = this.getNestedValue(
      config,
      "devices.entry.vsys.entry.rulebase.security.rules.entry",
    ) as Record<string, unknown>[] | undefined;

    if (!rulebase || !Array.isArray(rulebase)) {
      log.push({
        level: "warn",
        message: "No security rules found in XML config",
      });
      return rules;
    }

    rulebase.forEach((entry, idx) => {
      const name = (entry["@_name"] as string) || `rule-${idx + 1}`;
      rules.push({
        name,
        position: idx + 1,
        enabled: entry.disabled !== "yes",
        action: this.normalizeAction(entry.action as string),
        sources: this.toArray(this.getNestedValue(entry, "source.member")),
        destinations: this.toArray(
          this.getNestedValue(entry, "destination.member"),
        ),
        services: this.toArray(this.getNestedValue(entry, "service.member")),
        sourceZone: this.toArray(this.getNestedValue(entry, "from.member"))[0],
        destinationZone: this.toArray(
          this.getNestedValue(entry, "to.member"),
        )[0],
        description: entry.description as string,
        logging: entry["log-end"] === "yes" || entry["log-start"] === "yes",
        rawVendorData: {
          application: this.toArray(
            this.getNestedValue(entry, "application.member"),
          ),
          tag: this.toArray(this.getNestedValue(entry, "tag.member")),
        },
      });
    });

    log.push({
      level: "info",
      message: `Parsed ${rules.length} security rules from XML`,
    });
    return rules;
  }

  private parseXMLObjects(
    config: Record<string, unknown>,
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];
    const addrEntries = this.getNestedValue(
      config,
      "devices.entry.vsys.entry.address.entry",
    ) as Record<string, unknown>[] | undefined;

    if (Array.isArray(addrEntries)) {
      for (const entry of addrEntries) {
        const name = entry["@_name"] as string;
        const members: string[] = [];
        if (entry["ip-netmask"]) members.push(entry["ip-netmask"] as string);
        if (entry["ip-range"]) members.push(entry["ip-range"] as string);
        if (entry.fqdn) members.push(entry.fqdn as string);
        objects.push({ objectType: "address", name, members });
      }
    }

    const addrGrpEntries = this.getNestedValue(
      config,
      "devices.entry.vsys.entry.address-group.entry",
    ) as Record<string, unknown>[] | undefined;
    if (Array.isArray(addrGrpEntries)) {
      for (const entry of addrGrpEntries) {
        objects.push({
          objectType: "address-group",
          name: entry["@_name"] as string,
          members: this.toArray(this.getNestedValue(entry, "static.member")),
        });
      }
    }

    // Service objects: <service><entry name><protocol><tcp><port>
    const svcEntries = this.getNestedValue(
      config,
      "devices.entry.vsys.entry.service.entry",
    ) as Record<string, unknown>[] | undefined;
    if (Array.isArray(svcEntries)) {
      for (const entry of svcEntries) {
        const members: string[] = [];
        for (const proto of ["tcp", "udp"]) {
          const port = this.getNestedValue(entry, `protocol.${proto}.port`);
          if (port !== undefined && port !== null && String(port) !== "")
            members.push(`${proto}/${String(port).replace(/\s+/g, "")}`);
        }
        objects.push({
          objectType: "service",
          name: entry["@_name"] as string,
          members,
        });
      }
    }

    const svcGrpEntries = this.getNestedValue(
      config,
      "devices.entry.vsys.entry.service-group.entry",
    ) as Record<string, unknown>[] | undefined;
    if (Array.isArray(svcGrpEntries)) {
      for (const entry of svcGrpEntries) {
        objects.push({
          objectType: "service-group",
          name: entry["@_name"] as string,
          members: this.toArray(this.getNestedValue(entry, "members.member")),
        });
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${objects.length} address and service objects from XML`,
    });
    return objects;
  }

  private parseXMLInterfaces(
    config: Record<string, unknown>,
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    // Interface parsing from XML is complex — simplified for now
    log.push({
      level: "info",
      message: "Interface parsing from XML — basic support",
    });
    return [];
  }

  private parseSetCommands(rawConfig: string): ParseResult {
    const log: ParseLogEntry[] = [];
    const lines = rawConfig
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("set "));
    log.push({
      level: "info",
      message: `Parsing ${lines.length} set commands`,
    });

    const rules: NormalizedRule[] = [];
    const objects: NormalizedObject[] = [];
    const ruleData = new Map<string, Partial<NormalizedRule>>();
    const objectData = new Map<string, { type: string; members: string[] }>();

    for (const line of lines) {
      // set rulebase security rules <name> <field> <value>
      const ruleMatch = line.match(
        /^set rulebase security rules "?([^"]+)"?\s+(\S+)\s+(.+)$/,
      );
      if (ruleMatch) {
        const [, name, field, value] = ruleMatch;
        if (!ruleData.has(name))
          ruleData.set(name, {
            name,
            enabled: true,
            action: "permit",
            sources: [],
            destinations: [],
            services: [],
            logging: false,
          });
        const rule = ruleData.get(name)!;

        const values = value.split(/\s+/).map((v) => v.replace(/[\[\]"]/g, ""));

        switch (field) {
          case "from":
            rule.sourceZone = values[0];
            break;
          case "to":
            rule.destinationZone = values[0];
            break;
          case "source":
            rule.sources = values;
            break;
          case "destination":
            rule.destinations = values;
            break;
          case "service":
            rule.services = values;
            break;
          case "application":
            (rule.rawVendorData ??= {}).application = values;
            break;
          case "action":
            rule.action = this.normalizeAction(values[0]);
            break;
          case "disabled":
            rule.enabled = values[0] !== "yes";
            break;
          case "description":
            rule.description = value.replace(/^"(.*)"$/, "$1");
            break;
          case "log-end":
            rule.logging = values[0] === "yes";
            break;
        }
        continue;
      }

      // set address <name> ip-netmask|ip-range|fqdn <value>
      const addrMatch = line.match(
        /^set address "?([^"]+?)"?\s+(?:ip-netmask|ip-range|fqdn)\s+(\S+)$/,
      );
      if (addrMatch) {
        objectData.set(addrMatch[1], {
          type: "address",
          members: [addrMatch[2]],
        });
        continue;
      }

      // set service <name> protocol <tcp|udp> port <ports>
      const svcMatch = line.match(
        /^set service "?([^"]+?)"?\s+protocol\s+(tcp|udp)\s+port\s+(\S+)$/,
      );
      if (svcMatch) {
        objectData.set(svcMatch[1], {
          type: "service",
          members: [`${svcMatch[2]}/${svcMatch[3]}`],
        });
        continue;
      }

      // set service-group <name> members <members>
      const svcGrpMatch = line.match(
        /^set service-group "?([^"]+?)"?\s+members\s+(.+)$/,
      );
      if (svcGrpMatch) {
        const members = svcGrpMatch[2]
          .split(/\s+/)
          .map((v) => v.replace(/[\[\]"]/g, ""))
          .filter(Boolean);
        objectData.set(svcGrpMatch[1], { type: "service-group", members });
        continue;
      }

      // set address-group <name> static <members>
      const addrGrpMatch = line.match(
        /^set address-group "?([^"]+)"?\s+static\s+(.+)$/,
      );
      if (addrGrpMatch) {
        const members = addrGrpMatch[2]
          .split(/\s+/)
          .map((v) => v.replace(/[\[\]"]/g, ""));
        objectData.set(addrGrpMatch[1], { type: "address-group", members });
        continue;
      }
    }

    // Convert maps to arrays
    let pos = 0;
    for (const [, rule] of ruleData) {
      pos++;
      rules.push({
        name: rule.name!,
        position: pos,
        enabled: rule.enabled!,
        action: rule.action as NormalizedRule["action"],
        sources: rule.sources!,
        destinations: rule.destinations!,
        services: rule.services!,
        sourceZone: rule.sourceZone,
        destinationZone: rule.destinationZone,
        description: rule.description,
        logging: rule.logging!,
        rawVendorData: rule.rawVendorData,
      });
    }

    for (const [name, data] of objectData) {
      objects.push({
        objectType: data.type as NormalizedObject["objectType"],
        name,
        members: data.members,
      });
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} rules and ${objects.length} objects from set commands`,
    });

    return {
      rules,
      objects,
      natRules: [],
      interfaces: [],
      routes: [],
      parseLog: log,
      confidence: rules.length > 0 ? 0.85 : 0.4,
      warnings: log.filter((e) => e.level === "warn").map((e) => e.message),
    };
  }

  private normalizeAction(action: string): "permit" | "deny" | "drop" {
    if (!action) return "permit";
    const lower = action.toLowerCase();
    if (lower === "allow" || lower === "permit") return "permit";
    if (lower === "drop") return "drop";
    return "deny";
  }

  private toArray(value: unknown): string[] {
    if (!value) return ["any"];
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split(".");
    let current = obj;
    for (const key of keys) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== "object"
      )
        return undefined;
      const record = current as Record<string, unknown>;
      current = record[key];
      // If it's an array with single entry, unwrap
      if (Array.isArray(current) && current.length === 1 && key === "entry") {
        current = current[0];
      }
    }
    return current;
  }
}
