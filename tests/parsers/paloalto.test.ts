/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PaloAltoParser } from "../../src/lib/parsers/PaloAltoParser";
import type {
  ParseResult,
  ValidationResult,
} from "../../src/lib/parsers/types";

describe("PaloAltoParser", () => {
  let parser: PaloAltoParser;
  let rawConfig: string;
  let validation: ValidationResult;
  let result: ParseResult;

  beforeAll(async () => {
    parser = new PaloAltoParser();
    rawConfig = readFileSync(
      join(__dirname, "../fixtures/paloalto-config.xml"),
      "utf-8",
    );
    validation = parser.validate(rawConfig);
    result = await parser.parse(rawConfig);
  });

  describe("validate()", () => {
    it("should return valid=true for a PA XML config", () => {
      expect(validation.valid).toBe(true);
    });

    it("should identify vendor as PALO_ALTO", () => {
      expect(validation.vendor).toBe("PALO_ALTO");
    });

    it("should identify config type as xml", () => {
      expect(validation.configType).toBe("xml");
    });

    it("should report no errors", () => {
      expect(validation.errors).toHaveLength(0);
    });

    it("should report a positive line count", () => {
      expect(validation.lineCount).toBeGreaterThan(0);
    });

    it("should reject non-PA config", () => {
      const bogus = "config firewall policy\n    edit 1\n    next\nend\n";
      const result = parser.validate(bogus);
      expect(result.valid).toBe(false);
    });

    it("should accept set-format config as valid with configType=set", () => {
      const setConfig = 'set rulebase security rules "test" action allow\n';
      const result = parser.validate(setConfig);
      expect(result.valid).toBe(true);
      expect(result.configType).toBe("set");
    });
  });

  describe("parse() - security rules", () => {
    // The fixture has 15 security rule entries
    it("should parse 15 security rules", () => {
      expect(result.rules).toHaveLength(15);
    });

    it("should parse the first rule name", () => {
      expect(result.rules[0].name).toBe("Allow-Inbound-HTTPS");
    });

    it("should parse from/to zones on the first rule", () => {
      const rule = result.rules[0];
      expect(rule.sourceZone).toBe("untrust");
      expect(rule.destinationZone).toBe("dmz");
    });

    it("should parse source and destination on first rule", () => {
      const rule = result.rules[0];
      expect(rule.sources).toContain("any");
      expect(rule.destinations).toContain("web-servers");
    });

    it("should normalize allow action to permit", () => {
      const rule = result.rules[0];
      expect(rule.action).toBe("permit");
    });

    it("should normalize deny action", () => {
      const denyRule = result.rules.find((r) => r.name === "Deny-DMZ-to-LAN");
      expect(denyRule).toBeDefined();
      expect(denyRule!.action).toBe("deny");
    });

    it("should parse description field", () => {
      const rule = result.rules.find((r) => r.name === "Allow-Inbound-HTTPS");
      expect(rule).toBeDefined();
      expect(rule!.description).toBe(
        "Allow HTTPS to web servers from Internet",
      );
    });

    it("should parse log-end=yes as logging=true", () => {
      const rule = result.rules[0];
      expect(rule.logging).toBe(true);
    });

    it("should parse log-end=no as logging=false", () => {
      const dnsRule = result.rules.find((r) => r.name === "Allow-LAN-DNS");
      expect(dnsRule).toBeDefined();
      expect(dnsRule!.logging).toBe(false);
    });

    it("should parse disabled=yes as enabled=false", () => {
      const disabledRule = result.rules.find(
        (r) => r.name === "Disabled-Test-Rule",
      );
      expect(disabledRule).toBeDefined();
      expect(disabledRule!.enabled).toBe(false);
    });

    it("should parse two disabled rules total", () => {
      const disabledRules = result.rules.filter((r) => !r.enabled);
      expect(disabledRules).toHaveLength(2);
    });

    it("should parse enabled rules correctly", () => {
      const enabledRules = result.rules.filter((r) => r.enabled);
      expect(enabledRules).toHaveLength(13);
    });

    it("should assign sequential positions starting from 1", () => {
      for (let i = 0; i < result.rules.length; i++) {
        expect(result.rules[i].position).toBe(i + 1);
      }
    });

    it("should store application in rawVendorData", () => {
      const rule = result.rules[0];
      expect(rule.rawVendorData).toBeDefined();
      expect(rule.rawVendorData!.application).toBeDefined();
      const apps = rule.rawVendorData!.application as string[];
      expect(apps).toContain("ssl");
      expect(apps).toContain("web-browsing");
    });

    it("should parse service references", () => {
      const rule8443 = result.rules.find(
        (r) => r.name === "Allow-Inbound-8443",
      );
      expect(rule8443).toBeDefined();
      expect(rule8443!.services).toContain("tcp-8443");
    });

    it("should parse the deny-all rule as last rule", () => {
      const lastRule = result.rules[result.rules.length - 1];
      expect(lastRule.name).toBe("Deny-All");
      expect(lastRule.action).toBe("deny");
      expect(lastRule.sources).toContain("any");
      expect(lastRule.destinations).toContain("any");
    });
  });

  describe("parse() - address objects", () => {
    // 10 address entries + 3 address-group entries + 5 service entries = 18
    it("should parse 18 objects total (addresses, groups, services)", () => {
      expect(result.objects).toHaveLength(18);
    });

    it("should parse service objects with protocol and port", () => {
      const svc = result.objects.find((o) => o.name === "tcp-app-range");
      expect(svc!.objectType).toBe("service");
      expect(svc!.members).toEqual(["tcp/3000-3010"]);
      const syslog = result.objects.find((o) => o.name === "udp-syslog");
      expect(syslog!.members).toEqual(["udp/514"]);
    });

    it("should parse ip-netmask address objects", () => {
      const webSrv = result.objects.find((o) => o.name === "web-srv-01");
      expect(webSrv).toBeDefined();
      expect(webSrv!.objectType).toBe("address");
      expect(webSrv!.members).toContain("203.0.113.10/32");
    });

    it("should parse ip-range address objects", () => {
      const vpnPool = result.objects.find((o) => o.name === "vpn-pool");
      expect(vpnPool).toBeDefined();
      expect(vpnPool!.objectType).toBe("address");
      expect(vpnPool!.members[0]).toMatch(/10\.10\.10\.1-10\.10\.10\.254/);
    });

    it("should parse fqdn address objects", () => {
      const cdn = result.objects.find((o) => o.name === "cdn-endpoint");
      expect(cdn).toBeDefined();
      expect(cdn!.objectType).toBe("address");
      expect(cdn!.members).toContain("cdn.example.com");
    });

    it("should parse address groups with static members", () => {
      const webGrp = result.objects.find((o) => o.name === "web-servers");
      expect(webGrp).toBeDefined();
      expect(webGrp!.objectType).toBe("address-group");
      expect(webGrp!.members).toContain("web-srv-01");
      expect(webGrp!.members).toContain("web-srv-02");
    });

    it("should parse address group with 4 members", () => {
      const allSrv = result.objects.find((o) => o.name === "all-servers");
      expect(allSrv).toBeDefined();
      expect(allSrv!.members).toHaveLength(4);
    });
  });

  describe("parse() - metadata", () => {
    it("should have confidence >= 0.95 for XML config with rules", () => {
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("should have a non-empty parse log", () => {
      expect(result.parseLog.length).toBeGreaterThan(0);
    });

    it("should return an empty routes array", () => {
      expect(result.routes).toEqual([]);
    });

    it("should return a warnings array", () => {
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});
