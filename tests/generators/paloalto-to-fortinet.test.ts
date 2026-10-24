/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * PAN-OS -> FortiOS translation against the repo's PAN-OS fixture.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PaloAltoParser } from "../../src/lib/parsers/PaloAltoParser";
import { FortinetGenerator } from "../../src/lib/generators/FortinetGenerator";
import type { GeneratorResult } from "../../src/lib/generators/GeneratorInterface";
import type { NormalizedRule, ParseResult } from "../../src/lib/parsers/types";
import { fortiosReferenceProblems, FORTIOS_PREDEFINED_SERVICES } from "./helpers";

describe("PAN-OS -> FortiOS", () => {
  let parsed: ParseResult;
  let out: GeneratorResult;

  beforeAll(async () => {
    const raw = readFileSync(join(__dirname, "../fixtures/paloalto-config.xml"), "utf-8");
    parsed = await new PaloAltoParser().parse(raw);
    out = await new FortinetGenerator().generate(parsed.rules, parsed.objects, []);
  });

  const block = (name: string) => {
    const rc = out.ruleConfigs.find((r) => r.ruleName === name);
    expect(rc, name).toBeDefined();
    return rc!;
  };
  const serviceLine = (cfg: string) => cfg.match(/set service (.+)/)![1];

  it("never emits the PAN-OS keyword application-default", () => {
    expect(out.config).not.toMatch(/application-default/);
    for (const rc of out.ruleConfigs) expect(rc.config).not.toMatch(/application-default/);
  });

  it("uses only predefined or defined service names, and only defined addresses", () => {
    expect(fortiosReferenceProblems(out.config)).toEqual([]);
  });

  it("uses FortiOS 'all' / 'ALL', never the PAN-OS 'any', for addresses and services", () => {
    expect(out.config).not.toMatch(/set (srcaddr|dstaddr) .*"any"/);
    expect(out.config).not.toMatch(/set service .*"any"/);
  });

  it("resolves application-default from the App-IDs (ssl -> HTTPS, web-browsing -> HTTP)", () => {
    expect(serviceLine(block("Allow-Inbound-HTTPS").config)).toBe('"HTTPS" "HTTP"');
    expect(serviceLine(block("Allow-LAN-Web-Out").config)).toBe('"HTTPS" "HTTP"');
  });

  it("resolves dns -> DNS, ssh+ssl -> SSH HTTPS, ping -> PING", () => {
    expect(serviceLine(block("Allow-LAN-DNS").config)).toBe('"DNS"');
    expect(serviceLine(block("Allow-MGMT-to-DMZ").config)).toBe('"SSH" "HTTPS"');
    expect(serviceLine(block("Allow-ICMP-Internal").config)).toBe('"PING"');
  });

  it("keeps the App-IDs visible in the policy comments", () => {
    expect(block("Allow-Inbound-HTTPS").config).toMatch(/set comments ".*Source App-ID: ssl, web-browsing"/);
  });

  it("creates custom services for PAN-OS service objects with their ports", () => {
    expect(out.config).toMatch(/edit "tcp-app-range"\n\s+set tcp-portrange 3000-3010/);
    expect(out.config).toMatch(/edit "udp-syslog"\n\s+set udp-portrange 514/);
    expect(serviceLine(block("Allow-Inbound-8443").config)).toBe('"tcp-8443"');
  });

  it("emits ip-range objects as iprange and groups as addrgrp", () => {
    expect(out.config).toMatch(/edit "vpn-pool"\n\s+set type iprange\n\s+set start-ip 10\.10\.10\.1\n\s+set end-ip 10\.10\.10\.254/);
    expect(out.config).toMatch(/config firewall addrgrp\n\s+edit "web-servers"\n\s+set member "web-srv-01" "web-srv-02"/);
  });

  it("wraps all policies in one config firewall policy block", () => {
    const rules = out.config.slice(out.config.indexOf("config firewall policy"));
    expect(rules.trim().endsWith("end")).toBe(true);
    expect((rules.match(/^\s+edit \d+$/gm) ?? []).length).toBe(parsed.rules.length);
  });

  it("keeps disabled rules disabled and maps deny", () => {
    expect(block("Disabled-Test-Rule").config).toMatch(/set status disable/);
    expect(block("Deny-All").config).toMatch(/set action deny/);
  });

  it("gives mapped App-ID rules high confidence", () => {
    expect(block("Allow-Inbound-HTTPS").confidence).toBeGreaterThanOrEqual(0.85);
    expect(block("Allow-Inbound-8443").confidence).toBe(0.95);
  });

  describe("App-IDs without a port mapping", () => {
    const base: NormalizedRule = {
      name: "Custom-App",
      position: 1,
      enabled: true,
      action: "permit",
      sources: ["internal-net"],
      destinations: ["any"],
      services: ["application-default"],
      sourceZone: "trust",
      destinationZone: "untrust",
      logging: true,
    };

    it("flags and disables a rule whose only App-ID cannot be mapped", async () => {
      const r = await new FortinetGenerator().generate(
        [{ ...base, rawVendorData: { application: ["some-inhouse-app"] } }],
        parsed.objects,
        [],
      );
      const rc = r.ruleConfigs[0];
      expect(rc.config).not.toMatch(/application-default/);
      expect(rc.config).toMatch(/set status disable/);
      expect(rc.confidence).toBeLessThan(0.5);
      expect(rc.warnings.join(" ")).toMatch(/REVIEW: App-ID some-inhouse-app has no standard port mapping/);
      expect(fortiosReferenceProblems(r.config)).toEqual([]);
    });

    it("keeps the mapped part and flags the unmapped App-ID", async () => {
      const r = await new FortinetGenerator().generate(
        [{ ...base, rawVendorData: { application: ["ssl", "some-inhouse-app"] } }],
        parsed.objects,
        [],
      );
      const rc = r.ruleConfigs[0];
      expect(serviceLine(rc.config)).toBe('"HTTPS"');
      expect(rc.config).not.toMatch(/set status disable/);
      expect(rc.confidence).toBeLessThan(0.7);
      expect(rc.warnings.some((w) => w.startsWith("REVIEW:"))).toBe(true);
    });
  });

  it("only references FortiOS predefined services that exist", () => {
    const used = [...out.config.matchAll(/set service (.+)/g)].flatMap((m) =>
      [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
    );
    const custom = new Set([...out.config.matchAll(/^\s+edit "([^"]+)"/gm)].map((m) => m[1]));
    for (const s of used) expect(FORTIOS_PREDEFINED_SERVICES.has(s) || custom.has(s), s).toBe(true);
  });
});
