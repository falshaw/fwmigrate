/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * A rule the migration emits disabled must reach Change Manager disabled.
 */

import { describe, it, expect } from "vitest";
import { getGenerator } from "../../src/lib/generators/GeneratorFactory";
import { SUPPORTED_VENDORS } from "../../src/lib/vendors";
import { buildChangeManagerRules, configDisablesRule } from "../../src/lib/change-manager-integration";
import type { NormalizedObject, NormalizedRule } from "../../src/lib/parsers/types";

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
  { objectType: "address", name: "mon", members: ["192.0.2.20/32"] },
];

describe.each(SUPPORTED_VENDORS.map((v) => [v]))("pushed state for %s", (target) => {
  it("reads disabled from a rule emitted disabled and live from a live rule", async () => {
    const gen = getGenerator(target);
    const off = (await gen.generate([rule()], objects, [])).ruleConfigs[0].config;
    const on = (await gen.generate([rule({ sources: ["mon"] })], objects, [])).ruleConfigs[0].config;
    expect(configDisablesRule(off)).toBe(true);
    expect(configDisablesRule(on)).toBe(false);
  });
});

describe("buildChangeManagerRules", () => {
  const project = { id: "p", name: "P", sourceVendor: "PALO_ALTO", targetVendor: "FORTINET" };
  const tr = (targetConfig: string, extra: Record<string, unknown> = {}) => ({
    normalizedRule: {
      name: "r",
      action: "permit",
      sources: [],
      destinations: [],
      services: [],
      sourceZone: null,
      destinationZone: null,
      enabled: true,
    },
    targetConfig,
    manualOverride: null,
    reviewStatus: "APPROVED",
    confidence: 0.3,
    ...extra,
  });

  it("sends enabled false for a config emitted disabled", () => {
    const [p] = buildChangeManagerRules([tr("    edit 0\n        set status disable\n    next")], project);
    expect(p.enabled).toBe(false);
  });

  it("follows the engineer's changed config", () => {
    const [p] = buildChangeManagerRules(
      [tr("    edit 0\n        set status disable\n    next", { reviewStatus: "MODIFIED", manualOverride: "    edit 0\n    next" })],
      project,
    );
    expect(p.enabled).toBe(true);
  });
});
