/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Every source fixture through every target generator: the output must be
 * self-consistent (all references defined or predefined) and must not leak
 * another vendor's keywords (application-default, any vs all, ...).
 */

import { describe, it, expect } from "vitest";
import { getParser } from "../../src/lib/parsers/ParserFactory";
import { getGenerator } from "../../src/lib/generators/GeneratorFactory";
import { SUPPORTED_VENDORS } from "../../src/lib/vendors";
import { FOREIGN_TOKENS, REFERENCE_CHECKS, fixture } from "./helpers";

describe.each(SUPPORTED_VENDORS.map((v) => [v]))("source %s", (source) => {
  describe.each(SUPPORTED_VENDORS.map((v) => [v]))("-> target %s", (target) => {
    it("references only defined or predefined objects and no foreign keywords", async () => {
      const parsed = await getParser(source).parse(fixture(source));
      expect(parsed.rules.length).toBeGreaterThan(0);
      const out = await getGenerator(target).generate(parsed.rules, parsed.objects, []);

      expect(out.ruleConfigs).toHaveLength(parsed.rules.length);
      expect(REFERENCE_CHECKS[target](out.config)).toEqual([]);
      for (const re of FOREIGN_TOKENS[target]) expect(out.config, String(re)).not.toMatch(re);

      for (const rc of out.ruleConfigs) {
        expect(rc.confidence).toBeGreaterThan(0);
        expect(rc.confidence).toBeLessThanOrEqual(0.95);
        // Rules whose service could not be resolved are emitted disabled, never live
        if (rc.warnings.some((w) => w.includes("no service could be resolved")))
          expect(rc.config).toMatch(/status disable|disabled yes|inactive|^deactivate |enabled false/m);
      }
    });
  });
});

describe("vendor-specific translations", () => {
  it("Junos junos-https becomes FortiOS HTTPS and Check Point https", async () => {
    const parsed = await getParser("JUNIPER_SRX").parse(fixture("JUNIPER_SRX"));
    const forti = await getGenerator("FORTINET").generate(parsed.rules, parsed.objects, []);
    expect(forti.ruleConfigs[0].config).toMatch(/set service "HTTPS" "HTTP"/);
    const cp = await getGenerator("CHECKPOINT").generate(parsed.rules, parsed.objects, []);
    expect(cp.ruleConfigs[0].config).toMatch(/service\.1 "https"/);
  });

  it("FortiOS ALL becomes PAN-OS any, Junos any and ASA ip", async () => {
    const parsed = await getParser("FORTINET").parse(fixture("FORTINET"));
    const rule = parsed.rules.find((r) => r.services.includes("ALL"))!;
    expect(rule).toBeDefined();
    const pan = await getGenerator("PALO_ALTO").generate([rule], parsed.objects, []);
    expect(pan.config).toMatch(/service \[ "any" \]/);
    const srx = await getGenerator("JUNIPER_SRX").generate([rule], parsed.objects, []);
    expect(srx.config).toMatch(/match application any/);
    const asa = await getGenerator("CISCO_ASA").generate([rule], parsed.objects, []);
    expect(asa.config).toMatch(/extended (permit|deny) ip /);
  });

  it("FortiOS interfaces become Junos zone pairs and ASA ingress ACLs", async () => {
    const parsed = await getParser("FORTINET").parse(fixture("FORTINET"));
    const rule = parsed.rules[0];
    const srx = await getGenerator("JUNIPER_SRX").generate([rule], parsed.objects, []);
    expect(srx.config).toContain(`from-zone ${rule.sourceZone} to-zone ${rule.destinationZone}`);
    const asa = await getGenerator("CISCO_ASA").generate([rule], parsed.objects, []);
    expect(asa.config).toContain(`access-group ${rule.sourceZone}_access_in in interface ${rule.sourceZone}`);
  });

  it("zone mappings are applied", async () => {
    const parsed = await getParser("PALO_ALTO").parse(fixture("PALO_ALTO"));
    const out = await getGenerator("FORTINET").generate([parsed.rules[0]], parsed.objects, [
      { sourceZone: "untrust", targetZone: "wan1" },
      { sourceZone: "dmz", targetZone: "port3" },
    ]);
    expect(out.config).toContain('set srcintf "wan1"');
    expect(out.config).toContain('set dstintf "port3"');
  });

  it("PAN-OS ICMP App-ID stays App-ID when the target is PAN-OS", async () => {
    const parsed = await getParser("PALO_ALTO").parse(fixture("PALO_ALTO"));
    const out = await getGenerator("PALO_ALTO").generate(parsed.rules, parsed.objects, []);
    const icmp = out.ruleConfigs.find((r) => r.ruleName === "Allow-ICMP-Internal")!;
    expect(icmp.config).toMatch(/application \[ "ping" \]/);
    expect(icmp.config).toMatch(/service \[ "application-default" \]/);
  });

  it("unresolvable services are disabled with a review flag (Junos junos-pgsql)", async () => {
    const parsed = await getParser("JUNIPER_SRX").parse(fixture("JUNIPER_SRX"));
    const out = await getGenerator("FORTINET").generate(parsed.rules, parsed.objects, []);
    const rc = out.ruleConfigs.find((r) => r.ruleName === "Allow-DMZ-to-DB")!;
    expect(rc.config).toMatch(/set status disable/);
    expect(rc.confidence).toBeLessThan(0.5);
    expect(rc.warnings.join(" ")).toMatch(/junos-pgsql/);
  });

  it("manual overrides replace the generated block in the full config", async () => {
    const parsed = await getParser("PALO_ALTO").parse(fixture("PALO_ALTO"));
    const first = parsed.rules[0];
    const out = await getGenerator("FORTINET").generate([first], parsed.objects, [], {
      overrides: { [first.position]: '    edit 1\n        set name "manual"\n    next' },
    });
    expect(out.config).toContain('set name "manual"');
    expect(out.config).not.toContain('set name "Allow-Inbound-HTTPS"');
  });

  it("ASA rollback removes the exact ACE", () => {
    const gen = getGenerator("CISCO_ASA");
    const rule = {
      name: "r1",
      position: 1,
      enabled: true,
      action: "permit" as const,
      sources: ["192.0.2.0/24"],
      destinations: ["any"],
      services: ["tcp/443"],
      sourceZone: "inside",
      logging: false,
    };
    expect(gen.generateRollback(rule, []).command).toBe(
      "no access-list inside_access_in extended permit tcp 192.0.2.0 255.255.255.0 any eq 443",
    );
  });
});
