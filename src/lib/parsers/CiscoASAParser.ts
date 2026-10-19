/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Cisco ASA/FTD config parser
 * Parses `show running-config` output
 */

import type { IConfigParser } from "./ParserInterface";
import type {
  FirewallVendor,
  ParseResult,
  ValidationResult,
  NormalizedRule,
  NormalizedObject,
  NormalizedNATRule,
  NormalizedInterface,
  ParseLogEntry,
} from "./types";

export class CiscoASAParser implements IConfigParser {
  vendor: FirewallVendor = "CISCO_ASA";

  validate(rawConfig: string): ValidationResult {
    const lines = rawConfig.split("\n");
    const lineCount = lines.length;
    const errors: string[] = [];

    const hasASAMarkers = lines.some(
      (l) =>
        l.includes("ASA Version") ||
        l.includes("access-list") ||
        l.match(/^hostname\s/) ||
        l.match(/^interface\s/) ||
        l.includes("Cisco Adaptive Security"),
    );

    if (!hasASAMarkers)
      errors.push("Config does not appear to be Cisco ASA format");

    return {
      valid: errors.length === 0,
      vendor: "CISCO_ASA",
      configType: "text",
      errors,
      lineCount,
    };
  }

  async parse(rawConfig: string): Promise<ParseResult> {
    const log: ParseLogEntry[] = [];
    const lines = rawConfig.split("\n").map((l) => l.trimEnd());

    log.push({
      level: "info",
      message: `Parsing ${lines.length} lines of Cisco ASA config`,
    });

    const objects = this.parseObjects(lines, log);
    const rules = this.parseACLs(lines, objects, log);
    const natRules = this.parseNAT(lines, log);
    const interfaces = this.parseInterfaces(lines, log);

    const confidence = rules.length > 0 ? 0.9 : 0.5;

    return {
      rules,
      objects,
      natRules,
      interfaces,
      routes: [],
      parseLog: log,
      confidence,
      warnings: log.filter((e) => e.level === "warn").map((e) => e.message),
    };
  }

  private parseObjects(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];
    let currentObj: { name: string; type: string; members: string[] } | null =
      null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // object network <name>
      const netObjMatch = line.match(/^object network (\S+)/);
      if (netObjMatch) {
        if (currentObj)
          objects.push({
            objectType: currentObj.type as NormalizedObject["objectType"],
            name: currentObj.name,
            members: currentObj.members,
          });
        currentObj = { name: netObjMatch[1], type: "address", members: [] };
        continue;
      }

      // object-group network <name>
      const netGrpMatch = line.match(/^object-group network (\S+)/);
      if (netGrpMatch) {
        if (currentObj)
          objects.push({
            objectType: currentObj.type as NormalizedObject["objectType"],
            name: currentObj.name,
            members: currentObj.members,
          });
        currentObj = {
          name: netGrpMatch[1],
          type: "address-group",
          members: [],
        };
        continue;
      }

      // object-group service <name>
      const svcGrpMatch = line.match(/^object-group service (\S+)/);
      if (svcGrpMatch) {
        if (currentObj)
          objects.push({
            objectType: currentObj.type as NormalizedObject["objectType"],
            name: currentObj.name,
            members: currentObj.members,
          });
        currentObj = {
          name: svcGrpMatch[1],
          type: "service-group",
          members: [],
        };
        continue;
      }

      if (currentObj) {
        // host <ip>
        const hostMatch = line.match(/^\s*host (\S+)/);
        if (hostMatch) {
          currentObj.members.push(`${hostMatch[1]}/32`);
          continue;
        }

        // subnet <ip> <mask>
        const subnetMatch = line.match(/^\s*subnet (\S+) (\S+)/);
        if (subnetMatch) {
          const cidr = this.maskToCidr(subnetMatch[2]);
          currentObj.members.push(`${subnetMatch[1]}/${cidr}`);
          continue;
        }

        // network-object host <ip>
        const netObjHostMatch = line.match(/^\s*network-object host (\S+)/);
        if (netObjHostMatch) {
          currentObj.members.push(`${netObjHostMatch[1]}/32`);
          continue;
        }

        // network-object <ip> <mask>
        const netObjSubMatch = line.match(/^\s*network-object (\S+) (\S+)/);
        if (netObjSubMatch) {
          const cidr = this.maskToCidr(netObjSubMatch[2]);
          currentObj.members.push(`${netObjSubMatch[1]}/${cidr}`);
          continue;
        }

        // group-object <name>
        const grpObjMatch = line.match(/^\s*group-object (\S+)/);
        if (grpObjMatch) {
          currentObj.members.push(grpObjMatch[1]);
          continue;
        }

        // port-object eq <port>
        const portObjMatch = line.match(/^\s*port-object eq (\S+)/);
        if (portObjMatch) {
          currentObj.members.push(portObjMatch[1]);
          continue;
        }

        // port-object range <start> <end>
        const portRangeMatch = line.match(/^\s*port-object range (\S+) (\S+)/);
        if (portRangeMatch) {
          currentObj.members.push(`${portRangeMatch[1]}-${portRangeMatch[2]}`);
          continue;
        }

        // End of object block
        if (line && !line.startsWith(" ") && !line.startsWith("!")) {
          objects.push({
            objectType: currentObj.type as NormalizedObject["objectType"],
            name: currentObj.name,
            members: currentObj.members,
          });
          currentObj = null;
        }
      }
    }

    if (currentObj)
      objects.push({
        objectType: currentObj.type as NormalizedObject["objectType"],
        name: currentObj.name,
        members: currentObj.members,
      });

    log.push({ level: "info", message: `Parsed ${objects.length} objects` });
    return objects;
  }

  private parseACLs(
    lines: string[],
    _objects: NormalizedObject[],
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    let position = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("access-list")) continue;

      // access-list <name> extended <action> <protocol> <src> <dst> [eq <port>]
      const aclMatch = line.match(
        /^access-list\s+(\S+)\s+(?:line\s+\d+\s+)?extended\s+(permit|deny)\s+(\S+)\s+(.+)$/,
      );
      if (!aclMatch) {
        // Try remark
        if (line.includes("remark")) continue;
        log.push({
          level: "warn",
          message: `Unparsed ACL line: ${line}`,
          line: i + 1,
        });
        continue;
      }

      const [, aclName, action, protocol, rest] = aclMatch;
      position++;

      const { src, dst, service } = this.parseACLAddresses(protocol, rest);

      rules.push({
        name: `${aclName}-${position}`,
        position,
        enabled: true,
        action: action as "permit" | "deny",
        sources: src,
        destinations: dst,
        services: service,
        description: `ACL: ${aclName}`,
        logging: line.includes(" log"),
        rawVendorData: { aclName, originalLine: line },
      });
    }

    log.push({ level: "info", message: `Parsed ${rules.length} ACL rules` });
    return rules;
  }

  private parseACLAddresses(
    protocol: string,
    rest: string,
  ): { src: string[]; dst: string[]; service: string[] } {
    const tokens = rest.split(/\s+/);
    let idx = 0;

    const parseSrcDst = (): string[] => {
      if (idx >= tokens.length) return ["any"];
      const token = tokens[idx];

      if (token === "any" || token === "any4") {
        idx++;
        return ["any"];
      }
      if (token === "host") {
        idx++;
        return [`${tokens[idx++]}/32`];
      }
      if (token === "object-group" || token === "object") {
        idx++;
        return [tokens[idx++]];
      }
      // IP + mask
      if (token.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        const ip = tokens[idx++];
        const mask = tokens[idx++];
        if (mask) {
          const cidr = this.maskToCidr(mask);
          return [`${ip}/${cidr}`];
        }
        return [`${ip}/32`];
      }
      idx++;
      return [token];
    };

    const src = parseSrcDst();
    const dst = parseSrcDst();

    // Parse service/port
    const service: string[] = [];
    while (idx < tokens.length) {
      if (tokens[idx] === "eq") {
        idx++;
        service.push(`${protocol}/${tokens[idx++]}`);
      } else if (tokens[idx] === "range") {
        idx++;
        const start = tokens[idx++];
        const end = tokens[idx++];
        service.push(`${protocol}/${start}-${end}`);
      } else if (tokens[idx] === "object-group") {
        idx++;
        service.push(tokens[idx++]);
      } else {
        idx++;
      }
    }

    if (service.length === 0 && protocol !== "ip") {
      service.push(protocol);
    } else if (service.length === 0) {
      service.push("any");
    }

    return { src, dst, service };
  }

  private parseNAT(lines: string[], log: ParseLogEntry[]): NormalizedNATRule[] {
    const natRules: NormalizedNATRule[] = [];
    let position = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      // object nat
      const natMatch = trimmed.match(
        /^\s*nat\s+\((\S+),(\S+)\)\s+(static|dynamic)\s+(.+)$/,
      );
      if (natMatch) {
        position++;
        const [, srcIntf, dstIntf, natType, rest] = natMatch;
        natRules.push({
          position,
          natType: natType as NormalizedNATRule["natType"],
          originalSource: [srcIntf],
          translatedSource: [rest.split(/\s+/)[0]],
          originalDest: [dstIntf],
          translatedDest: [],
          rawVendorData: { originalLine: trimmed },
        });
      }
    }

    log.push({ level: "info", message: `Parsed ${natRules.length} NAT rules` });
    return natRules;
  }

  private parseInterfaces(
    lines: string[],
    log: ParseLogEntry[],
  ): NormalizedInterface[] {
    const interfaces: NormalizedInterface[] = [];
    let current: NormalizedInterface | null = null;

    for (const line of lines) {
      const trimmed = line.trimEnd();
      const intfMatch = trimmed.match(/^interface (\S+)/);
      if (intfMatch) {
        if (current) interfaces.push(current);
        current = { name: intfMatch[1], enabled: true };
        continue;
      }

      if (current) {
        const nameifMatch = trimmed.match(/^\s+nameif (\S+)/);
        if (nameifMatch) {
          current.zone = nameifMatch[1];
          continue;
        }

        const ipMatch = trimmed.match(/^\s+ip address (\S+) (\S+)/);
        if (ipMatch) {
          current.ip = ipMatch[1];
          current.mask = ipMatch[2];
          continue;
        }

        if (trimmed.match(/^\s+shutdown/)) {
          current.enabled = false;
          continue;
        }

        const vlanMatch = trimmed.match(/^\s+vlan (\d+)/);
        if (vlanMatch) {
          current.vlan = parseInt(vlanMatch[1]);
          continue;
        }
      }
    }
    if (current) interfaces.push(current);

    log.push({
      level: "info",
      message: `Parsed ${interfaces.length} interfaces`,
    });
    return interfaces;
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
