/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Junos evaluates global policies after all zone policies, whatever the
 * source order. A global policy above a zone rule must be flagged.
 */

import { describe, it, expect } from "vitest";
import { JuniperSRXGenerator } from "../../src/lib/generators/JuniperSRXGenerator";
import type { NormalizedRule } from "../../src/lib/parsers/types";

const rule = (over: Partial<NormalizedRule>): NormalizedRule => ({
  name: "r",
  position: 1,
  enabled: true,
  action: "permit",
  sources: ["192.0.2.0/24"],
  destinations: ["any"],
  services: ["tcp/443"],
  logging: false,
  ...over,
});

const ORDER = /REVIEW: the SRX evaluates global policies after all zone policies/;

describe("SRX global policy order", () => {
  it("flags a global policy that comes before a zone policy and lowers its confidence", async () => {
    const rules = [
      rule({ name: "Block-All", position: 1, action: "deny", services: ["any"], sources: ["any"] }),
      rule({ name: "Web-Out", position: 2, sourceZone: "trust", destinationZone: "untrust" }),
    ];
    const out = await new JuniperSRXGenerator().generate(rules, [], []);
    const [global, zone] = out.ruleConfigs;
    expect(global.config).toMatch(/global policy Block-All/);
    expect(global.warnings.some((w) => ORDER.test(w) && w.includes("Web-Out"))).toBe(true);
    expect(global.confidence).toBeLessThanOrEqual(0.7);
    expect(zone.warnings.some((w) => ORDER.test(w))).toBe(false);
  });

  it("does not flag a global policy after every zone policy", async () => {
    const rules = [
      rule({ name: "Web-Out", position: 1, sourceZone: "trust", destinationZone: "untrust" }),
      rule({ name: "Block-All", position: 2, action: "deny", services: ["any"], sources: ["any"] }),
    ];
    const out = await new JuniperSRXGenerator().generate(rules, [], []);
    expect(out.ruleConfigs.some((rc) => rc.warnings.some((w) => ORDER.test(w)))).toBe(false);
  });

  it("ignores rules emitted deactivated", async () => {
    const rules = [
      rule({ name: "Old-Global", position: 1, enabled: false }),
      rule({ name: "Web-Out", position: 2, sourceZone: "trust", destinationZone: "untrust" }),
    ];
    const out = await new JuniperSRXGenerator().generate(rules, [], []);
    expect(out.ruleConfigs[0].warnings.some((w) => ORDER.test(w))).toBe(false);
  });
});
