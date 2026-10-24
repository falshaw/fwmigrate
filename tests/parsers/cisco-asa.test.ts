/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CiscoASAParser } from "../../src/lib/parsers/CiscoASAParser";
import type {
  ParseResult,
  ValidationResult,
} from "../../src/lib/parsers/types";

describe("CiscoASAParser", () => {
  let parser: CiscoASAParser;
  let rawConfig: string;
  let validation: ValidationResult;
  let result: ParseResult;

  beforeAll(async () => {
    parser = new CiscoASAParser();
    rawConfig = readFileSync(
      join(__dirname, "../fixtures/cisco-asa-show-run.txt"),
      "utf-8",
    );
    validation = parser.validate(rawConfig);
    result = await parser.parse(rawConfig);
  });

  describe("validate()", () => {
    it("should return valid=true for a Cisco ASA config", () => {
      expect(validation.valid).toBe(true);
    });

    it("should identify vendor as CISCO_ASA", () => {
      expect(validation.vendor).toBe("CISCO_ASA");
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

    it("should reject non-ASA config text", () => {
      const bogus = "config firewall policy\n    edit 1\n    next\nend\n";
      const result = parser.validate(bogus);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("parse() - ACL rules", () => {
    // The fixture has these extended ACL lines (excluding remark lines):
    // OUTSIDE_IN: 5 rules (3 permit + 2 deny)
    // INSIDE_OUT: 6 rules (5 permit + 1 deny)
    // DMZ_IN: 3 rules (2 permit + 1 deny)
    // MGMT_ACL: 3 rules (2 permit + 1 deny)
    // Total: 17 rules
    it("should parse 17 ACL rules", () => {
      expect(result.rules).toHaveLength(17);
    });

    it("should parse the first rule with correct action and destination", () => {
      const firstRule = result.rules[0];
      expect(firstRule.action).toBe("permit");
      expect(firstRule.sources).toEqual(["any"]);
      expect(firstRule.destinations).toEqual(["WEB-SERVERS"]);
      expect(firstRule.services).toEqual(["tcp/https"]);
    });

    it("should parse host-based source correctly", () => {
      // DMZ_IN first rule (global position 12): permit tcp host 203.0.113.10 host 192.0.2.50 eq 5432
      const dmzRule = result.rules.find((r) => r.name === "DMZ_IN-12");
      expect(dmzRule).toBeDefined();
      expect(dmzRule!.sources).toEqual(["203.0.113.10/32"]);
      expect(dmzRule!.destinations).toEqual(["192.0.2.50/32"]);
      expect(dmzRule!.services).toEqual(["tcp/5432"]);
    });

    it("should parse subnet source correctly", () => {
      // INSIDE_OUT first rule (global position 6): permit tcp 192.0.2.0 255.255.255.0 any eq https
      const lanRule = result.rules.find((r) => r.name === "INSIDE_OUT-6");
      expect(lanRule).toBeDefined();
      expect(lanRule!.sources).toEqual(["192.0.2.0/24"]);
      expect(lanRule!.destinations).toEqual(["any"]);
    });

    it("should parse deny rules", () => {
      const denyRules = result.rules.filter((r) => r.action === "deny");
      expect(denyRules.length).toBeGreaterThanOrEqual(4);
    });

    it('should detect logging from "log" keyword', () => {
      // OUTSIDE_IN deny ip any any log
      const logRule = result.rules.find((r) => r.name === "OUTSIDE_IN-5");
      expect(logRule).toBeDefined();
      expect(logRule!.logging).toBe(true);
    });

    it("should set logging=false for rules without log keyword", () => {
      // OUTSIDE_IN permit tcp any object-group WEB-SERVERS eq https (no log)
      const noLogRule = result.rules[0];
      expect(noLogRule.logging).toBe(false);
    });

    it("should include rawVendorData with the ACL name", () => {
      const rule = result.rules[0];
      expect(rule.rawVendorData).toBeDefined();
      expect(rule.rawVendorData!.aclName).toBe("OUTSIDE_IN");
    });

    it("should assign sequential positions", () => {
      for (let i = 0; i < result.rules.length; i++) {
        expect(result.rules[i].position).toBe(i + 1);
      }
    });

    it("should set all ACL rules as enabled (ASA ACLs do not have inline disable)", () => {
      for (const rule of result.rules) {
        expect(rule.enabled).toBe(true);
      }
    });
  });

  describe("parse() - objects", () => {
    // object network: WEB-SERVER-01, WEB-SERVER-02, DB-SERVER-01, INTERNAL-SUBNET, DMZ-SUBNET, MGMT-HOST = 6
    // object-group network: WEB-SERVERS, TRUSTED-NETS = 2
    // object-group service: WEB-PORTS, MGMT-PORTS, DNS-PORTS, HIGH-PORTS = 4
    // Total: 12
    it("should parse 12 objects", () => {
      expect(result.objects).toHaveLength(12);
    });

    it("should parse object network entries as address type", () => {
      const webSrv = result.objects.find((o) => o.name === "WEB-SERVER-01");
      expect(webSrv).toBeDefined();
      expect(webSrv!.objectType).toBe("address");
      expect(webSrv!.members).toEqual(["203.0.113.10/32"]);
    });

    it("should parse subnet objects", () => {
      const intNet = result.objects.find((o) => o.name === "INTERNAL-SUBNET");
      expect(intNet).toBeDefined();
      expect(intNet!.objectType).toBe("address");
      expect(intNet!.members).toEqual(["192.0.2.0/24"]);
    });

    it("should parse object-group network as address-group", () => {
      const webGrp = result.objects.find((o) => o.name === "WEB-SERVERS");
      expect(webGrp).toBeDefined();
      expect(webGrp!.objectType).toBe("address-group");
      expect(webGrp!.members).toContain("203.0.113.10/32");
      expect(webGrp!.members).toContain("203.0.113.11/32");
    });

    it("should parse object-group network with group-object references", () => {
      const trusted = result.objects.find((o) => o.name === "TRUSTED-NETS");
      expect(trusted).toBeDefined();
      expect(trusted!.objectType).toBe("address-group");
      expect(trusted!.members).toContain("192.0.2.0/24");
      expect(trusted!.members).toContain("WEB-SERVERS");
    });

    it("should parse object-group service as service-group", () => {
      const webPorts = result.objects.find((o) => o.name === "WEB-PORTS");
      expect(webPorts).toBeDefined();
      expect(webPorts!.objectType).toBe("service-group");
      expect(webPorts!.members).toContain("https");
      expect(webPorts!.members).toContain("http");
      expect(webPorts!.members).toContain("8443");
    });

    it("should parse port-object range in service groups", () => {
      const highPorts = result.objects.find((o) => o.name === "HIGH-PORTS");
      expect(highPorts).toBeDefined();
      expect(highPorts!.objectType).toBe("service-group");
      expect(highPorts!.members).toContain("8000-8999");
    });
  });

  describe("parse() - NAT rules", () => {
    // nat (inside,outside) dynamic interface
    // nat (dmz,outside) static 198.51.100.10
    // nat (inside,dmz) static 192.0.2.50 203.0.113.50
    it("should parse 3 NAT rules", () => {
      expect(result.natRules).toHaveLength(3);
    });

    it("should assign sequential positions to NAT rules", () => {
      for (let i = 0; i < result.natRules.length; i++) {
        expect(result.natRules[i].position).toBe(i + 1);
      }
    });

    it("should parse dynamic NAT type", () => {
      const dynamicNat = result.natRules.find((r) => r.natType === "dynamic");
      expect(dynamicNat).toBeDefined();
    });

    it("should parse static NAT type", () => {
      const staticNats = result.natRules.filter((r) => r.natType === "static");
      expect(staticNats.length).toBe(2);
    });
  });

  describe("parse() - interfaces", () => {
    // GigabitEthernet0/0 (outside), 0/1 (inside), 0/2 (dmz), 0/3 (shutdown)
    it("should parse 4 interfaces", () => {
      expect(result.interfaces).toHaveLength(4);
    });

    it("should parse interface IP and mask", () => {
      const outside = result.interfaces.find((i) => i.zone === "outside");
      expect(outside).toBeDefined();
      expect(outside!.ip).toBe("198.51.100.1");
      expect(outside!.mask).toBe("255.255.255.252");
    });

    it("should parse nameif as zone", () => {
      const inside = result.interfaces.find((i) => i.zone === "inside");
      expect(inside).toBeDefined();
      expect(inside!.ip).toBe("192.0.2.1");
    });

    it("should mark shutdown interface as disabled", () => {
      const shutdownIntf = result.interfaces.find(
        (i) => i.name === "GigabitEthernet0/3",
      );
      expect(shutdownIntf).toBeDefined();
      expect(shutdownIntf!.enabled).toBe(false);
    });

    it("should mark active interfaces as enabled", () => {
      const activeIntfs = result.interfaces.filter(
        (i) => i.name !== "GigabitEthernet0/3",
      );
      for (const intf of activeIntfs) {
        expect(intf.enabled).toBe(true);
      }
    });
  });

  describe("parse() - metadata", () => {
    it("should have confidence >= 0.9 when rules are found", () => {
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should have a non-empty parse log", () => {
      expect(result.parseLog.length).toBeGreaterThan(0);
    });

    it("should return an empty routes array", () => {
      expect(result.routes).toEqual([]);
    });
  });
});
