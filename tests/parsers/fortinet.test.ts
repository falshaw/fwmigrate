/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { FortinetParser } from "../../src/lib/parsers/FortinetParser";
import type {
  ParseResult,
  ValidationResult,
} from "../../src/lib/parsers/types";

describe("FortinetParser", () => {
  let parser: FortinetParser;
  let rawConfig: string;
  let validation: ValidationResult;
  let result: ParseResult;

  beforeAll(async () => {
    parser = new FortinetParser();
    rawConfig = readFileSync(
      join(__dirname, "../fixtures/fortinet-config.txt"),
      "utf-8",
    );
    validation = parser.validate(rawConfig);
    result = await parser.parse(rawConfig);
  });

  describe("validate()", () => {
    it("should return valid=true for FortiOS config", () => {
      expect(validation.valid).toBe(true);
    });

    it("should identify vendor as FORTINET", () => {
      expect(validation.vendor).toBe("FORTINET");
    });

    it("should identify config type as text", () => {
      expect(validation.configType).toBe("text");
    });

    it("should report no errors", () => {
      expect(validation.errors).toHaveLength(0);
    });

    it("should report a positive line count", () => {
      expect(validation.lineCount).toBeGreaterThan(0);
    });

    it("should reject non-FortiOS config", () => {
      const bogus = "hostname FW-EDGE-01\ninterface GigabitEthernet0/0\n";
      const result = parser.validate(bogus);
      expect(result.valid).toBe(false);
    });
  });

  describe("parse() - firewall policies", () => {
    // The fixture has 14 policy entries (edit 1 through edit 14)
    it("should parse 14 firewall policies", () => {
      expect(result.rules).toHaveLength(14);
    });

    it("should parse first policy name and action", () => {
      const rule1 = result.rules.find((r) => r.name === "WAN-to-DMZ-HTTPS");
      expect(rule1).toBeDefined();
      expect(rule1!.action).toBe("permit");
    });

    it("should parse source and destination interface as zones", () => {
      const rule1 = result.rules.find((r) => r.name === "WAN-to-DMZ-HTTPS");
      expect(rule1).toBeDefined();
      expect(rule1!.sourceZone).toBe("port1");
      expect(rule1!.destinationZone).toBe("port3");
    });

    it("should parse source and destination addresses", () => {
      const rule1 = result.rules.find((r) => r.name === "WAN-to-DMZ-HTTPS");
      expect(rule1).toBeDefined();
      expect(rule1!.sources).toEqual(["all"]);
      expect(rule1!.destinations).toEqual(["WEB-SERVERS"]);
    });

    it("should parse quoted multi-value services", () => {
      const rule1 = result.rules.find((r) => r.name === "WAN-to-DMZ-HTTPS");
      expect(rule1).toBeDefined();
      expect(rule1!.services).toContain("HTTPS");
      expect(rule1!.services).toContain("HTTP");
    });

    it("should parse deny action", () => {
      const denyRule = result.rules.find((r) => r.name === "Deny-DMZ-to-LAN");
      expect(denyRule).toBeDefined();
      expect(denyRule!.action).toBe("deny");
    });

    it("should parse disabled policy as enabled=false", () => {
      const disabled = result.rules.find(
        (r) => r.name === "Disabled-Test-Rule",
      );
      expect(disabled).toBeDefined();
      expect(disabled!.enabled).toBe(false);
    });

    it("should parse enabled policies as enabled=true", () => {
      const enabledRules = result.rules.filter(
        (r) => r.name !== "Disabled-Test-Rule",
      );
      for (const rule of enabledRules) {
        expect(rule.enabled).toBe(true);
      }
    });

    it("should parse logging enabled (logtraffic all or utm)", () => {
      const rule1 = result.rules.find((r) => r.name === "WAN-to-DMZ-HTTPS");
      expect(rule1).toBeDefined();
      expect(rule1!.logging).toBe(true);
    });

    it("should parse logging disabled (logtraffic disable)", () => {
      const dnsRule = result.rules.find((r) => r.name === "LAN-to-WAN-DNS");
      expect(dnsRule).toBeDefined();
      expect(dnsRule!.logging).toBe(false);
    });

    it("should parse comments as description", () => {
      const rule1 = result.rules.find((r) => r.name === "WAN-to-DMZ-HTTPS");
      expect(rule1).toBeDefined();
      expect(rule1!.description).toBe("Allow internet access to web servers");
    });

    it("should include rawVendorData with policy ID", () => {
      const rule1 = result.rules.find((r) => r.name === "WAN-to-DMZ-HTTPS");
      expect(rule1).toBeDefined();
      expect(rule1!.rawVendorData).toBeDefined();
      expect(rule1!.rawVendorData!.policyId).toBe("1");
    });

    it("should have correct position for each rule", () => {
      for (const rule of result.rules) {
        expect(rule.position).toBeGreaterThan(0);
      }
    });
  });

  describe("parse() - address objects", () => {
    // 10 firewall address entries + 3 addrgrp entries + 4 custom services = 17
    it("should parse 17 objects total (addresses + groups + custom services)", () => {
      expect(result.objects).toHaveLength(17);
    });

    it("should parse custom services with their port ranges", () => {
      const app = result.objects.find((o) => o.name === "APP-PORTS");
      expect(app!.objectType).toBe("service");
      expect(app!.members).toEqual(["tcp/3000-3010"]);
    });

    it("should parse subnet address as address type with CIDR member", () => {
      const webSrv = result.objects.find((o) => o.name === "WEB-SRV-01");
      expect(webSrv).toBeDefined();
      expect(webSrv!.objectType).toBe("address");
      expect(webSrv!.members[0]).toMatch(/203\.0\.113\.10/);
    });

    it("should parse FQDN address", () => {
      const fqdnAddr = result.objects.find((o) => o.name === "EXTERNAL-DNS");
      expect(fqdnAddr).toBeDefined();
      expect(fqdnAddr!.objectType).toBe("address");
      expect(fqdnAddr!.members).toContain("dns.example.com");
    });

    it("should parse address group with members", () => {
      const webGrp = result.objects.find((o) => o.name === "WEB-SERVERS");
      expect(webGrp).toBeDefined();
      expect(webGrp!.objectType).toBe("address-group");
      expect(webGrp!.members).toContain("WEB-SRV-01");
      expect(webGrp!.members).toContain("WEB-SRV-02");
    });

    it("should parse address groups with 3+ members", () => {
      const allSrvGrp = result.objects.find((o) => o.name === "ALL-SERVERS");
      expect(allSrvGrp).toBeDefined();
      expect(allSrvGrp!.objectType).toBe("address-group");
      expect(allSrvGrp!.members.length).toBe(4);
    });
  });

  describe("parse() - interfaces", () => {
    // 4 interfaces: port1, port2, port3, port4
    it("should parse 4 interfaces", () => {
      expect(result.interfaces).toHaveLength(4);
    });

    it("should parse interface IP address", () => {
      const port1 = result.interfaces.find((i) => i.name === "port1");
      expect(port1).toBeDefined();
      expect(port1!.ip).toBe("198.51.100.1");
    });

    it("should parse disabled interface (status down)", () => {
      const port4 = result.interfaces.find((i) => i.name === "port4");
      expect(port4).toBeDefined();
      expect(port4!.enabled).toBe(false);
    });

    it("should parse active interfaces as enabled", () => {
      const port1 = result.interfaces.find((i) => i.name === "port1");
      expect(port1).toBeDefined();
      expect(port1!.enabled).toBe(true);
    });
  });

  describe("parse() - metadata", () => {
    it("should have confidence >= 0.9 when rules are found", () => {
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should return empty natRules array", () => {
      expect(result.natRules).toEqual([]);
    });

    it("should return empty routes array", () => {
      expect(result.routes).toEqual([]);
    });

    it("should have a non-empty parse log", () => {
      expect(result.parseLog.length).toBeGreaterThan(0);
    });
  });
});
