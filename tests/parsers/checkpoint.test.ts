/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CheckPointParser } from "../../src/lib/parsers/CheckPointParser";
import type {
  ParseResult,
  ValidationResult,
} from "../../src/lib/parsers/types";

describe("CheckPointParser", () => {
  let parser: CheckPointParser;
  let rawConfig: string;
  let validation: ValidationResult;
  let result: ParseResult;

  beforeAll(async () => {
    parser = new CheckPointParser();
    rawConfig = readFileSync(
      join(__dirname, "../fixtures/checkpoint-export.json"),
      "utf-8",
    );
    validation = parser.validate(rawConfig);
    result = await parser.parse(rawConfig);
  });

  describe("validate()", () => {
    it("should return valid=true for Check Point JSON export", () => {
      expect(validation.valid).toBe(true);
    });

    it("should identify vendor as CHECKPOINT", () => {
      expect(validation.vendor).toBe("CHECKPOINT");
    });

    it("should identify config type as json", () => {
      expect(validation.configType).toBe("json");
    });

    it("should report no errors", () => {
      expect(validation.errors).toHaveLength(0);
    });

    it("should report a positive line count", () => {
      expect(validation.lineCount).toBeGreaterThan(0);
    });

    it("should reject invalid JSON", () => {
      const bogus = "this is not json {[}]";
      const result = parser.validate(bogus);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Config is not valid JSON");
    });

    it("should reject valid JSON without Check Point structure", () => {
      const bogus = JSON.stringify({ version: "1.0", data: [] });
      const result = parser.validate(bogus);
      expect(result.valid).toBe(false);
    });
  });

  describe("parse() - access rules", () => {
    // The fixture has 12 rule entries in the rulebase array.
    // All have type "access-rule" so none are skipped.
    it("should parse 12 access rules", () => {
      expect(result.rules).toHaveLength(12);
    });

    it("should parse the first rule name", () => {
      expect(result.rules[0].name).toBe("Allow-Inbound-HTTPS");
    });

    it("should assign sequential positions", () => {
      for (let i = 0; i < result.rules.length; i++) {
        expect(result.rules[i].position).toBe(i + 1);
      }
    });

    it("should map Accept action to permit", () => {
      const rule = result.rules[0];
      expect(rule.action).toBe("permit");
    });

    it("should map Drop action to drop", () => {
      const denyRule = result.rules.find((r) => r.name === "Deny-DMZ-to-LAN");
      expect(denyRule).toBeDefined();
      expect(denyRule!.action).toBe("drop");
    });

    it("should resolve source object UIDs to names/values", () => {
      // Rule 1 source is Any (CpmiAnyObject) -> resolves to 'any'
      const rule = result.rules[0];
      expect(rule.sources).toContain("any");
    });

    it("should resolve destination group objects", () => {
      // Rule 1 destination is web-servers group
      const rule = result.rules[0];
      expect(rule.destinations).toContain("web-servers");
    });

    it("should keep host object names in rule sources (value lives in the object)", () => {
      // Rule 4 (Allow-DMZ-to-DB) source is web-servers group
      // Rule 5 (Allow-MGMT-SSH) source is mgmt-host
      const mgmtRule = result.rules.find((r) => r.name === "Allow-MGMT-SSH");
      expect(mgmtRule).toBeDefined();
      expect(mgmtRule!.sources).toContain("mgmt-host");
      const obj = result.objects.find((o) => o.name === "mgmt-host");
      expect(obj!.members).toContain("192.0.2.100/32");
    });

    it("should keep network object names in rule sources", () => {
      // Rule 2 source is internal-net -> 192.0.2.0/24
      const lanRule = result.rules.find((r) => r.name === "Allow-LAN-Web-Out");
      expect(lanRule).toBeDefined();
      expect(lanRule!.sources).toContain("internal-net");
      const obj = result.objects.find((o) => o.name === "internal-net");
      expect(obj!.members).toContain("192.0.2.0/24");
    });

    it("should resolve service object names", () => {
      // Rule 1 services: https, http
      const rule = result.rules[0];
      expect(rule.services).toContain("https");
      expect(rule.services).toContain("http");
    });

    it("should parse comments as description", () => {
      const rule = result.rules[0];
      expect(rule.description).toBe("Allow inbound web traffic to DMZ servers");
    });

    it("should parse enabled rules", () => {
      const enabledRules = result.rules.filter((r) => r.enabled);
      expect(enabledRules).toHaveLength(10);
    });

    it("should parse disabled rules with enabled=false", () => {
      const disabledRules = result.rules.filter((r) => !r.enabled);
      expect(disabledRules).toHaveLength(2);
    });

    it("should identify specific disabled rules by name", () => {
      const testRule = result.rules.find(
        (r) => r.name === "Disabled-Test-Rule",
      );
      expect(testRule).toBeDefined();
      expect(testRule!.enabled).toBe(false);

      const legacyRule = result.rules.find((r) => r.name === "Disabled-Legacy");
      expect(legacyRule).toBeDefined();
      expect(legacyRule!.enabled).toBe(false);
    });

    it("should detect logging from track object", () => {
      // Rule 1 has track with type Log
      const rule = result.rules[0];
      expect(rule.logging).toBe(true);
    });

    it("should include rawVendorData with uid", () => {
      const rule = result.rules[0];
      expect(rule.rawVendorData).toBeDefined();
      expect(rule.rawVendorData!.uid).toBe("rule-001");
    });

    it("should parse the Deny-All rule as last rule with drop action", () => {
      const lastRule = result.rules[result.rules.length - 1];
      expect(lastRule.name).toBe("Deny-All");
      expect(lastRule.action).toBe("drop");
      expect(lastRule.sources).toContain("any");
      expect(lastRule.destinations).toContain("any");
    });
  });

  describe("parse() - object resolution", () => {
    // The extractObjects method pulls from the objectsMap:
    // 5 hosts + 3 networks = 8 address objects
    // 2 groups = 2 address-group objects
    // 5 service-tcp + 1 service-udp = 6 service objects
    // Total: 16
    it("should extract 16 objects from the dictionary", () => {
      expect(result.objects).toHaveLength(16);
    });

    it("should classify host objects as address type", () => {
      const webSrv = result.objects.find((o) => o.name === "web-srv-01");
      expect(webSrv).toBeDefined();
      expect(webSrv!.objectType).toBe("address");
      expect(webSrv!.members).toContain("203.0.113.10/32");
    });

    it("should classify network objects as address type", () => {
      const intNet = result.objects.find((o) => o.name === "internal-net");
      expect(intNet).toBeDefined();
      expect(intNet!.objectType).toBe("address");
      expect(intNet!.members).toContain("192.0.2.0/24");
    });

    it("should classify group objects as address-group type", () => {
      const grp = result.objects.find((o) => o.name === "web-servers");
      expect(grp).toBeDefined();
      expect(grp!.objectType).toBe("address-group");
      expect(grp!.members).toEqual(["web-srv-01", "web-srv-02"]);
    });

    it("should keep service objects with their ports, but not actions or tracks", () => {
      const svcObj = result.objects.find((o) => o.name === "https");
      expect(svcObj!.objectType).toBe("service");
      expect(svcObj!.members).toEqual(["tcp/443"]);
      const actionObj = result.objects.find((o) => o.name === "Accept");
      expect(actionObj).toBeUndefined();
      const trackObj = result.objects.find((o) => o.name === "Log");
      expect(trackObj).toBeUndefined();
    });

    it("should not include CpmiAnyObject in objects list", () => {
      const anyObj = result.objects.find((o) => o.name === "Any");
      expect(anyObj).toBeUndefined();
    });
  });

  describe("parse() - metadata", () => {
    it("should have confidence >= 0.85 when rules are found", () => {
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
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
