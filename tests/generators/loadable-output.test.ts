/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Output a device accepts: undefined names get a placeholder and a disabled
 * rule, FortiOS policies never overwrite existing IDs, disabled rules are not
 * reported as permissive, and same-platform service names pass through.
 */

import { describe, it, expect } from "vitest";
import { getGenerator } from "../../src/lib/generators/GeneratorFactory";
import { PLACEHOLDER_ADDRESS } from "../../src/lib/generators/base";
import { FortinetGenerator } from "../../src/lib/generators/FortinetGenerator";
import { SUPPORTED_VENDORS } from "../../src/lib/vendors";
import type { NormalizedObject, NormalizedRule } from "../../src/lib/parsers/types";
import { REFERENCE_CHECKS } from "./helpers";
import { buildTargetConfig } from "../../src/lib/export/targetConfig";

const rule = (over: Partial<NormalizedRule> = {}): NormalizedRule => ({
  name: "Allow-Monitoring",
  position: 1,
  enabled: true,
  action: "permit",
  sources: ["nms-poller"],
  destinations: ["web-srv"],
  services: ["tcp/443"],
  sourceZone: "trust",
  destinationZone: "dmz",
  logging: true,
  ...over,
});

const objects: NormalizedObject[] = [
  { objectType: "address", name: "web-srv", members: ["192.0.2.10/32"] },
];

describe.each(SUPPORTED_VENDORS.map((v) => [v]))("undefined address -> %s", (target) => {
  it("creates a placeholder object, disables the rule and leaves no undefined reference", async () => {
    const out = await getGenerator(target).generate([rule()], objects, []);
    expect(out.config).toContain("nms-poller");
    expect(out.config).toContain(PLACEHOLDER_ADDRESS);
    expect(REFERENCE_CHECKS[target](out.config)).toEqual([]);
    const rc = out.ruleConfigs[0];
    expect(rc.confidence).toBeLessThanOrEqual(0.3);
    expect(rc.warnings.join(" ")).toMatch(/nms-poller .*not defined.*DISABLED with a placeholder/);
    // the rule itself is emitted disabled / inactive / deactivated
    expect(rc.config).toMatch(/set status disable|inactive|disabled yes|enabled false|^deactivate /m);
  });

  it("keeps a fully defined rule live", async () => {
    const out = await getGenerator(target).generate([rule({ sources: ["web-srv"] })], objects, []);
    expect(out.config).not.toContain("nms-poller");
    expect(out.ruleConfigs[0].config).not.toMatch(/set status disable|inactive|disabled yes|enabled false|^deactivate /m);
  });
});

describe("FortiOS policy IDs", () => {
  it("uses edit 0 so the FortiGate assigns free IDs instead of overwriting policies", async () => {
    const out = await new FortinetGenerator().generate(
      [rule({ sources: ["web-srv"], position: 7 }), rule({ name: "Second", sources: ["web-srv"], position: 9 })],
      objects,
      [],
    );
    const policyBlock = out.config.slice(out.config.indexOf("config firewall policy"));
    expect(policyBlock.match(/^\s+edit (\S+)/gm)!.map((l) => l.trim())).toEqual(["edit 0", "edit 0"]);
  });

  it("rolls back by looking the policy up by name, not by a guessed ID", () => {
    const rb = new FortinetGenerator().generateRollback(rule({ position: 7 }), []);
    expect(rb.command).toContain('show firewall policy | grep -f "Allow-Monitoring"');
    expect(rb.command).not.toMatch(/delete 7\b/);
  });
});

describe("disabled any/any/any rule", () => {
  it.each(SUPPORTED_VENDORS.map((v) => [v]))("is not reported as overly permissive (%s)", async (target) => {
    const r = rule({ enabled: false, sources: ["any"], destinations: ["any"], services: ["any"] });
    const out = await getGenerator(target).generate([r], [], []);
    expect(out.ruleConfigs[0].warnings.join(" ")).not.toMatch(/overly permissive/);
  });
});

describe("platform-predefined services", () => {
  const srx = rule({ sources: ["web-srv"], services: ["junos-pgsql"] });

  it("pass through unchanged when source and target are the same platform", async () => {
    const out = await getGenerator("JUNIPER_SRX").generate([srx], objects, []);
    expect(out.ruleConfigs[0].config).toMatch(/match application junos-pgsql$/m);
    expect(out.ruleConfigs[0].config).not.toMatch(/^deactivate /m);
  });

  it("stay unresolved (and the rule disabled) for another platform", async () => {
    const out = await getGenerator("FORTINET").generate([srx], objects, []);
    expect(out.ruleConfigs[0].warnings.join(" ")).toMatch(/junos-pgsql/);
    expect(out.ruleConfigs[0].config).toMatch(/set status disable/);
  });
});

describe("buildTargetConfig (project and batch export)", () => {
  it("emits the objects the rules reference, before the rules", async () => {
    const { config, commentPrefix } = await buildTargetConfig({
      targetVendor: "JUNIPER_SRX",
      translatedRules: [
        {
          reviewStatus: "PENDING",
          manualOverride: null,
          normalizedRule: {
            ...rule({ sources: ["web-srv"] }),
            sourceZone: "trust",
            destinationZone: "dmz",
            description: null,
          },
        },
      ],
      normalizedObjects: objects.map((o) => ({ ...o, rawVendorData: null })),
      zoneMappings: [{ sourceZone: "trust", targetZone: "inside" }],
    });
    expect(commentPrefix).toBe("#");
    expect(config).toMatch(/address-book global address web-srv /);
    expect(config.indexOf("address-book")).toBeLessThan(config.indexOf("security policies"));
    expect(config).toContain("from-zone inside");
    expect(REFERENCE_CHECKS.JUNIPER_SRX(config)).toEqual([]);
  });
});
