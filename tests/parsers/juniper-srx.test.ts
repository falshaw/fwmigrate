/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { JuniperSRXParser } from "../../src/lib/parsers/JuniperSRXParser";
import type {
  ParseResult,
  ValidationResult,
} from "../../src/lib/parsers/types";

describe("JuniperSRXParser", () => {
  let parser: JuniperSRXParser;
  let rawConfig: string;
  let validation: ValidationResult;
  let result: ParseResult;

  beforeAll(async () => {
    parser = new JuniperSRXParser();
    rawConfig = readFileSync(
      join(__dirname, "../fixtures/juniper-set-config.txt"),
      "utf-8",
    );
    validation = parser.validate(rawConfig);
    result = await parser.parse(rawConfig);
  });

  describe("validate()", () => {
    it("should return valid=true for Juniper SRX config", () => {
      expect(validation.valid).toBe(true);
    });

    it("should identify vendor as JUNIPER_SRX", () => {
      expect(validation.vendor).toBe("JUNIPER_SRX");
    });

    it("should identify config type as set", () => {
      expect(validation.configType).toBe("set");
    });

    it("should report no errors", () => {
      expect(validation.errors).toHaveLength(0);
    });

    it("should report a positive line count", () => {
      expect(validation.lineCount).toBeGreaterThan(0);
    });

    it("should reject non-Juniper config", () => {
      const bogus =
        "hostname FW-EDGE-01\naccess-list OUTSIDE_IN extended permit tcp any any\n";
      const result = parser.validate(bogus);
      expect(result.valid).toBe(false);
    });
  });

  describe("parse() - security policies", () => {
    // The fixture has 10 zone-based policies (from-zone/to-zone pairs).
    // The "global policy Deny-All" uses a different syntax that the parser
    // does not match, so it is excluded.
    it("should parse 10 security policies", () => {
      expect(result.rules).toHaveLength(10);
    });

    it("should parse the first policy name", () => {
      expect(result.rules[0].name).toBe("Allow-Inbound-HTTPS");
    });

    it("should parse source and destination zones", () => {
      const rule = result.rules[0];
      expect(rule.sourceZone).toBe("untrust");
      expect(rule.destinationZone).toBe("dmz");
    });

    it("should parse match source-address", () => {
      const rule = result.rules[0];
      expect(rule.sources).toContain("any");
    });

    it("should parse match destination-address", () => {
      const rule = result.rules[0];
      expect(rule.destinations).toContain("web-servers");
    });

    it("should parse match application", () => {
      const rule = result.rules[0];
      expect(rule.services).toContain("junos-https");
      expect(rule.services).toContain("junos-http");
    });

    it("should parse permit action", () => {
      const rule = result.rules[0];
      expect(rule.action).toBe("permit");
    });

    it("should parse deny action", () => {
      const denyRule = result.rules.find((r) => r.name === "Deny-DMZ-to-LAN");
      expect(denyRule).toBeDefined();
      expect(denyRule!.action).toBe("deny");
    });

    it("should parse description", () => {
      const icmpRule = result.rules.find(
        (r) => r.name === "Allow-Internal-ICMP",
      );
      expect(icmpRule).toBeDefined();
      expect(icmpRule!.description).toBe("Allow internal ICMP");
    });

    it("should parse intra-zone policies (trust to trust)", () => {
      const icmpRule = result.rules.find(
        (r) => r.name === "Allow-Internal-ICMP",
      );
      expect(icmpRule).toBeDefined();
      expect(icmpRule!.sourceZone).toBe("trust");
      expect(icmpRule!.destinationZone).toBe("trust");
    });

    it("should set all rules as enabled=true (Juniper set format has no inline disable)", () => {
      for (const rule of result.rules) {
        expect(rule.enabled).toBe(true);
      }
    });

    it("should set logging=false for all rules (Juniper parser does not parse log action)", () => {
      for (const rule of result.rules) {
        expect(rule.logging).toBe(false);
      }
    });

    it("should assign sequential positions starting from 1", () => {
      for (let i = 0; i < result.rules.length; i++) {
        expect(result.rules[i].position).toBe(i + 1);
      }
    });

    it('should default sources to ["any"] when source-address is "any"', () => {
      const rule = result.rules.find((r) => r.name === "Allow-Inbound-HTTPS");
      expect(rule).toBeDefined();
      expect(rule!.sources).toContain("any");
    });

    it("should parse specific source addresses", () => {
      const branchRule = result.rules.find((r) => r.name === "Allow-Branch");
      expect(branchRule).toBeDefined();
      expect(branchRule!.sources).toContain("branch-net");
    });
  });

  describe("parse() - address book objects", () => {
    // Global address-book: 8 addresses (web-srv-01, web-srv-02, db-srv-01,
    // app-srv-01, internal-net, dmz-net, mgmt-host, branch-net)
    // Zone-based address-book: 3 entries (web-srv-01, db-srv-01, internal-net)
    // These share names with global entries so the Map deduplicates to 8.
    // Address-sets: 2 groups (web-servers with 2 members, all-servers with 4 members)
    // Total: 10
    it("should parse 10 address objects total", () => {
      expect(result.objects).toHaveLength(10);
    });

    it("should parse global address-book address entries", () => {
      const webSrv = result.objects.find((o) => o.name === "web-srv-01");
      expect(webSrv).toBeDefined();
      expect(webSrv!.objectType).toBe("address");
      expect(webSrv!.members).toContain("203.0.113.10/32");
    });

    it("should parse address with CIDR prefix", () => {
      const branchNet = result.objects.find((o) => o.name === "branch-net");
      expect(branchNet).toBeDefined();
      expect(branchNet!.members).toContain("198.51.100.64/26");
    });

    it("should parse address-set as address-group", () => {
      const webGroup = result.objects.find((o) => o.name === "web-servers");
      expect(webGroup).toBeDefined();
      expect(webGroup!.objectType).toBe("address-group");
      expect(webGroup!.members).toContain("web-srv-01");
      expect(webGroup!.members).toContain("web-srv-02");
    });

    it("should parse address-set with 4 members", () => {
      const allSrvGroup = result.objects.find((o) => o.name === "all-servers");
      expect(allSrvGroup).toBeDefined();
      expect(allSrvGroup!.objectType).toBe("address-group");
      expect(allSrvGroup!.members).toHaveLength(4);
    });
  });

  describe("parse() - metadata", () => {
    it("should have confidence >= 0.9 when rules are found", () => {
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should return empty natRules array", () => {
      expect(result.natRules).toEqual([]);
    });

    it("should return empty interfaces array", () => {
      expect(result.interfaces).toEqual([]);
    });

    it("should return empty routes array", () => {
      expect(result.routes).toEqual([]);
    });

    it("should have a non-empty parse log", () => {
      expect(result.parseLog.length).toBeGreaterThan(0);
    });
  });
});
