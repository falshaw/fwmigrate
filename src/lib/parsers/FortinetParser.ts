/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Fortinet FortiOS config parser
 * Parses `config/edit/set/next/end` block format
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

export class FortinetParser implements IConfigParser {
  vendor: FirewallVendor = "FORTINET";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const errors: string[] = [];
    const hasFortiMarkers = lines.some(
      (l) =>
        l.includes("config firewall policy") ||
        l.includes("config system interface") ||
        l.includes("config firewall address") ||
        l.match(/^#config-version=/),
    );
    if (!hasFortiMarkers)
      errors.push("Config does not appear to be FortiOS format");
    return {
      valid: errors.length === 0,
      vendor: "FORTINET",
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
      message: `Parsing ${lines.length} lines of FortiOS config`,
    });

    const objects = this.parseAddresses(lines, log);
    const rules = this.parsePolicies(lines, log);
    const interfaces = this.parseInterfaces(lines, log);

    return {
      rules,
      objects,
      natRules: [],
      interfaces,
      routes: [],
      parseLog: log,
      confidence: rules.length > 0 ? 0.9 : 0.5,
      warnings: log.filter((e) => e.level === "warn").map((e) => e.message),
    };
  }

  private parseBlock(
    lines: string[],
    startPattern: RegExp,
  ): { entries: Record<string, Record<string, string>>[]; endIdx: number }[] {
    const blocks: {
      entries: Record<string, Record<string, string>>[];
      endIdx: number;
    }[] = [];
    let i = 0;

    while (i < lines.length) {
      if (startPattern.test(lines[i].trim())) {
        const entries: Record<string, Record<string, string>>[] = [];
        let current: Record<string, string> | null = null;
        let currentId = "";
        i++;

        while (i < lines.length) {
          const trimmed = lines[i].trim();

          if (trimmed === "end") {
            i++;
            break;
          }

          const editMatch = trimmed.match(/^edit\s+"?(\S+?)"?$/);
          if (editMatch) {
            if (current) entries.push({ [currentId]: current });
            currentId = editMatch[1];
            current = {};
            i++;
            continue;
          }

          if (trimmed === "next") {
            if (current) entries.push({ [currentId]: current });
            current = null;
            i++;
            continue;
          }

          if (current) {
            const setMatch = trimmed.match(/^set\s+(\S+)\s+(.+)$/);
            if (setMatch) {
              current[setMatch[1]] = setMatch[2].replace(/^"(.*)"$/, "$1");
            }
          }
          i++;
        }

        if (current) entries.push({ [currentId]: current });
        blocks.push({ entries, endIdx: i });
      }
      i++;
    }
    return blocks;
  }

  private parsePolicies(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    const blocks = this.parseBlock(lines, /^config firewall policy$/);

    for (const block of blocks) {
      for (const entry of block.entries) {
        const [id, fields] = Object.entries(entry)[0];
        const position = parseInt(id) || rules.length + 1;

        rules.push({
          name: fields.name || `policy-${id}`,
          position,
          enabled: fields.status !== "disable",
          action: fields.action === "accept" ? "permit" : "deny",
          sources: this.splitQuoted(fields.srcaddr || "all"),
          destinations: this.splitQuoted(fields.dstaddr || "all"),
          services: this.splitQuoted(fields.service || "ALL"),
          sourceZone: fields.srcintf?.replace(/"/g, ""),
          destinationZone: fields.dstintf?.replace(/"/g, ""),
          description: fields.comments,
          logging: fields.logtraffic !== "disable",
          rawVendorData: { policyId: id, ...fields },
        });
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${rules.length} firewall policies`,
    });
    return rules;
  }

  private parseAddresses(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];
    const blocks = this.parseBlock(lines, /^config firewall address$/);

    for (const block of blocks) {
      for (const entry of block.entries) {
        const [name, fields] = Object.entries(entry)[0];
        const members: string[] = [];

        if (fields.subnet) {
          const parts = fields.subnet.split(/\s+/);
          if (parts.length === 2)
            members.push(`${parts[0]}/${this.maskToCidr(parts[1])}`);
          else members.push(fields.subnet);
        }
        if (fields.fqdn) members.push(fields.fqdn);
        if (fields["start-ip"])
          members.push(
            `${fields["start-ip"]}-${fields["end-ip"] || fields["start-ip"]}`,
          );

        objects.push({ objectType: "address", name, members });
      }
    }

    // Address groups
    const grpBlocks = this.parseBlock(lines, /^config firewall addrgrp$/);
    for (const block of grpBlocks) {
      for (const entry of block.entries) {
        const [name, fields] = Object.entries(entry)[0];
        objects.push({
          objectType: "address-group",
          name,
          members: this.splitQuoted(fields.member || ""),
        });
      }
    }

    // Custom services and service groups
    for (const block of this.parseBlock(lines, /^config firewall service custom$/)) {
      for (const entry of block.entries) {
        const [name, fields] = Object.entries(entry)[0];
        const members: string[] = [];
        for (const proto of ["tcp", "udp"]) {
          const range = fields[`${proto}-portrange`];
          if (!range) continue;
          for (const tok of range.split(/\s+/).filter(Boolean)) {
            // "dst[:src]" — only the destination part is matched here
            members.push(`${proto}/${tok.split(":")[0]}`);
          }
        }
        if ((fields.protocol || "").toUpperCase() === "ICMP") members.push("icmp");
        objects.push({ objectType: "service", name, members });
      }
    }
    for (const block of this.parseBlock(lines, /^config firewall service group$/)) {
      for (const entry of block.entries) {
        const [name, fields] = Object.entries(entry)[0];
        objects.push({
          objectType: "service-group",
          name,
          members: this.splitQuoted(fields.member || ""),
        });
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${objects.length} address and service objects`,
    });
    return objects;
  }

  private parseInterfaces(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    const interfaces: NormalizedInterface[] = [];
    const blocks = this.parseBlock(lines, /^config system interface$/);

    for (const block of blocks) {
      for (const entry of block.entries) {
        const [name, fields] = Object.entries(entry)[0];
        const ipParts = (fields.ip || "").split(/\s+/);
        interfaces.push({
          name,
          ip: ipParts[0] || undefined,
          mask: ipParts[1] || undefined,
          zone: fields.zone || undefined,
          vlan: fields.vlanid ? parseInt(fields.vlanid) : undefined,
          enabled: fields.status !== "down",
        });
      }
    }

    log.push({
      level: "info",
      message: `Parsed ${interfaces.length} interfaces`,
    });
    return interfaces;
  }

  private splitQuoted(value: string): string[] {
    if (!value) return [];
    return (
      value.match(/"[^"]+"/g)?.map((s) => s.replace(/"/g, "")) ||
      value.split(/\s+/).filter(Boolean)
    );
  }

  private maskToCidr(mask: string): number {
    const parts = mask.split(".").map(Number);
    let cidr = 0;
    for (const part of parts) {
      cidr += (part >>> 0).toString(2).split("1").length - 1;
    }
    return cidr;
  }
}
