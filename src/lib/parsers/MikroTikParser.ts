/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * MikroTik RouterOS config parser
 * Parses MikroTik `/export` command output
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

export class MikroTikParser implements IConfigParser {
  vendor: FirewallVendor = "MIKROTIK";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const hasMarkers = lines.some(
      (l) =>
        l.includes("/ip firewall filter") ||
        l.includes("/ip address") ||
        l.includes("# RouterOS") ||
        l.includes("/interface") ||
        l.match(/^\/ip\s/),
    );
    if (!hasMarkers)
      errors.push("Config does not appear to be MikroTik RouterOS format");
    return {
      valid: errors.length === 0,
      vendor: "MIKROTIK",
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
      message: `Parsing ${lines.length} lines of MikroTik config`,
    });

    const rules = this.parseFirewallFilter(lines, log);
    const objects = this.parseAddressLists(lines, log);
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

  private parseFirewallFilter(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    let inSection = false;
    let position = 1;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "/ip firewall filter") {
        inSection = true;
        continue;
      }
      // New section starts with /
      if (
        inSection &&
        trimmed.startsWith("/") &&
        trimmed !== "/ip firewall filter"
      ) {
        inSection = false;
        continue;
      }

      if (inSection && trimmed.startsWith("add ")) {
        const params = this.parseParams(trimmed.slice(4));

        rules.push({
          name: params.comment || `mt-rule-${position}`,
          position,
          enabled: params.disabled !== "yes",
          action:
            params.action === "drop" || params.action === "reject"
              ? "deny"
              : "permit",
          sources: params["src-address"] ? [params["src-address"]] : ["any"],
          destinations: params["dst-address"]
            ? [params["dst-address"]]
            : ["any"],
          services: this.parseService(params.protocol, params["dst-port"]),
          sourceZone: params["in-interface"],
          destinationZone: params["out-interface"],
          description: params.comment,
          logging: params.log === "yes",
          rawVendorData: { ...params },
        });
        position++;
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} firewall filter rules`,
    });
    return rules;
  }

  private parseAddressLists(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const listMap: Record<string, string[]> = {};
    let inSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "/ip firewall address-list") {
        inSection = true;
        continue;
      }
      if (
        inSection &&
        trimmed.startsWith("/") &&
        trimmed !== "/ip firewall address-list"
      ) {
        inSection = false;
        continue;
      }

      if (inSection && trimmed.startsWith("add ")) {
        const params = this.parseParams(trimmed.slice(4));
        if (params.list && params.address) {
          if (!listMap[params.list]) listMap[params.list] = [];
          listMap[params.list].push(params.address);
        }
      }
    }

    const objects: NormalizedObject[] = Object.entries(listMap).map(
      ([name, members]) => ({
        objectType:
          members.length > 1
            ? ("address-group" as const)
            : ("address" as const),
        name,
        members,
      }),
    );

    log.push({
      level: "info",
      message: `Parsed ${objects.length} address lists`,
    });
    return objects;
  }

  private parseInterfaces(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    const interfaces: NormalizedInterface[] = [];
    let inSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "/ip address") {
        inSection = true;
        continue;
      }
      if (inSection && trimmed.startsWith("/") && trimmed !== "/ip address") {
        inSection = false;
        continue;
      }

      if (inSection && trimmed.startsWith("add ")) {
        const params = this.parseParams(trimmed.slice(4));
        if (params.interface) {
          const [ip, mask] = (params.address || "").split("/");
          interfaces.push({
            name: params.interface,
            ip: ip || undefined,
            mask: mask ? `/${mask}` : undefined,
            zone: params.interface,
            enabled: params.disabled !== "yes",
          });
        }
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${interfaces.length} interfaces`,
    });
    return interfaces;
  }

  private parseParams(paramStr: string): Record<string, string> {
    const params: Record<string, string> = {};
    const regex = /(\S+?)=(\S+|"[^"]*")/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(paramStr)) !== null) {
      params[match[1]] = match[2].replace(/^"|"$/g, "");
    }
    return params;
  }

  private parseService(
    protocol: string | undefined,
    port: string | undefined,
  ): string[] {
    if (!protocol) return ["any"];
    if (port) return [`${protocol}/${port}`];
    return [protocol];
  }
}
