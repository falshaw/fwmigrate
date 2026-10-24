/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * A complete target configuration for a set of translated rules: the objects
 * those rules reference, then the rules, in the target vendor's syntax. Used
 * by the project export and the batch export so both emit the same loadable
 * config.
 */

import { getGenerator } from "@/lib/generators/GeneratorFactory";
import { toNormalizedRule, type PrismaNormalizedRuleRecord } from "@/lib/mappers/ruleMapper";
import type { FirewallVendor, NormalizedObject } from "@/lib/parsers/types";

export interface ExportRuleRecord {
  reviewStatus: string;
  manualOverride: string | null;
  normalizedRule: PrismaNormalizedRuleRecord;
}

export interface ExportObjectRecord {
  objectType: string;
  name: string;
  members: unknown;
  rawVendorData: unknown;
}

export async function buildTargetConfig(input: {
  targetVendor: string;
  translatedRules: ExportRuleRecord[];
  normalizedObjects: ExportObjectRecord[];
  zoneMappings: Array<{ sourceZone: string; targetZone: string }>;
}): Promise<{ config: string; commentPrefix: string }> {
  const generator = getGenerator(input.targetVendor as FirewallVendor);
  const rules = input.translatedRules.map((t) => toNormalizedRule(t.normalizedRule));
  const objects: NormalizedObject[] = input.normalizedObjects.map((o) => ({
    objectType: o.objectType as NormalizedObject["objectType"],
    name: o.name,
    members: o.members as string[],
    rawVendorData: o.rawVendorData as Record<string, unknown> | undefined,
  }));
  // Manual overrides replace the generated block of their rule
  const overrides: Record<number, string> = {};
  for (const t of input.translatedRules) {
    if (t.reviewStatus === "MODIFIED" && t.manualOverride)
      overrides[t.normalizedRule.position] = t.manualOverride;
  }
  const generated = await generator.generate(rules, objects, input.zoneMappings, { overrides });
  return { config: generated.config, commentPrefix: generator.commentPrefix };
}
