/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import { analyzeRuleset } from "../../src/lib/analysis/RuleAnalysisEngine";
import type { NormalizedRule } from "../../src/lib/parsers/types";

/**
 * Helper to create a NormalizedRule with sensible defaults.
 * Override any field via the partial parameter.
 */
function makeRule(
  overrides: Partial<NormalizedRule> & { position: number; name: string },
): NormalizedRule {
  return {
    enabled: true,
    action: "permit",
    sources: ["192.0.2.0/24"],
    destinations: ["203.0.113.0/24"],
    services: ["tcp/443"],
    logging: false,
    ...overrides,
  };
}

describe("RuleAnalysisEngine — analyzeRuleset", () => {
  describe("overly permissive detection", () => {
    it("should flag a permit any/any/any rule as critical permissive", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "permit-all",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.permissive).toBe(1);
      const issue = result.issues.find((i) => i.type === "permissive");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("critical");
      expect(issue!.rulePosition).toBe(1);
      expect(issue!.description).toContain("permits ALL traffic");
    });

    it("should not flag a deny any/any/any rule as permissive", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "deny-all",
          action: "deny",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.permissive).toBe(0);
    });

    it("grades a specific source with any destination and any service as high, not critical", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "permit-specific",
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["any"],
          services: ["any"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.permissive).toBe(1);
      expect(result.issues[0].severity).toBe("high");
      expect(result.issues[0].description).toContain("every service to any destination");
    });

    it("does not flag a specific source, destination and service as permissive", () => {
      const result = analyzeRuleset([
        makeRule({ position: 1, name: "web", sources: ["192.0.2.10/32"], destinations: ["203.0.113.10/32"] }),
      ]);
      expect(result.summary.permissive).toBe(0);
    });

    it("should not flag disabled permit any/any/any as permissive", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "disabled-permit-all",
          enabled: false,
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.permissive).toBe(0);
    });
  });

  describe("shadow detection", () => {
    it("should detect a fully shadowed rule (same action)", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "broad-permit",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "narrow-permit",
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.shadows).toBeGreaterThanOrEqual(1);
      const shadow = result.issues.find((i) => i.type === "shadow");
      expect(shadow).toBeDefined();
      expect(shadow!.rulePosition).toBe(2);
      expect(shadow!.relatedRulePosition).toBe(1);
      expect(shadow!.severity).toBe("high");
      expect(shadow!.description).toContain("shadowed");
    });

    it("should not detect shadow when rules address different subnets", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "rule-subnet-A",
          sources: ["192.0.2.0/24"],
          destinations: ["203.0.113.0/24"],
          services: ["tcp/443"],
        }),
        makeRule({
          position: 2,
          name: "rule-subnet-B",
          sources: ["198.51.100.0/24"],
          destinations: ["10.0.0.0/8"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.shadows).toBe(0);
    });

    it("should skip disabled rules during shadow analysis", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "broad-permit",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "disabled-narrow",
          enabled: false,
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      const shadowIssues = result.issues.filter((i) => i.type === "shadow");
      expect(shadowIssues).toHaveLength(0);
    });
  });

  describe("conflict detection", () => {
    it("should detect conflict when shadowed rule has different action", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "permit-all",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "deny-specific",
          action: "deny",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.conflicts).toBeGreaterThanOrEqual(1);
      const conflict = result.issues.find((i) => i.type === "conflict");
      expect(conflict).toBeDefined();
      expect(conflict!.severity).toBe("critical");
      expect(conflict!.rulePosition).toBe(2);
      expect(conflict!.relatedRulePosition).toBe(1);
    });
  });

  describe("clean ruleset", () => {
    it("should return no issues for a well-structured non-overlapping ruleset", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "allow-web",
          sourceZone: "trust",
          destinationZone: "untrust",
          sources: ["192.0.2.0/24"],
          destinations: ["203.0.113.0/24"],
          services: ["tcp/443"],
          action: "permit",
        }),
        makeRule({
          position: 2,
          name: "allow-dns",
          sourceZone: "trust",
          destinationZone: "untrust",
          sources: ["192.0.2.0/24"],
          destinations: ["198.51.100.53/32"],
          services: ["udp/53"],
          action: "permit",
        }),
        makeRule({
          position: 3,
          name: "deny-rest",
          sourceZone: "trust",
          destinationZone: "untrust",
          sources: ["192.0.2.0/24"],
          destinations: ["any"],
          services: ["any"],
          action: "deny",
        }),
      ];

      const result = analyzeRuleset(rules);
      // The deny-rest rule will shadow the earlier rules since it covers any/any,
      // but it comes AFTER them so it does not shadow them. However, the earlier
      // rules are contained within the later one with different action = conflict.
      // For a truly clean test we need non-overlapping rules.
      // Actually: the analysis checks if EARLIER rules shadow LATER ones.
      // Rule 3 (deny any/any) is checked against earlier rules 1 and 2.
      // Earlier rule 1 (192.0.2.0/24 -> 203.0.113.0/24 tcp/443) does not contain
      // later rule 3 (192.0.2.0/24 -> any, any). So rule 1 does NOT shadow rule 3.
      // This means no shadow/conflict is detected in that direction. Good.
      expect(result.summary.shadows).toBe(0);
      expect(result.summary.conflicts).toBe(0);
      expect(result.summary.permissive).toBe(0);
    });
  });

  describe("disabled rules are skipped", () => {
    it("should not analyze disabled rules at all", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "disabled-broad",
          enabled: false,
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "active-narrow",
          enabled: true,
          action: "permit",
          sources: ["192.0.2.0/24"],
          destinations: ["203.0.113.0/24"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      // Disabled rule should not trigger permissive detection
      expect(result.summary.permissive).toBe(0);
      // Disabled rule should not shadow active rule
      expect(result.summary.shadows).toBe(0);
      expect(result.summary.conflicts).toBe(0);
    });
  });

  describe("output structure", () => {
    it("should return totalRules matching input length", () => {
      const rules: NormalizedRule[] = [
        makeRule({ position: 1, name: "rule-1" }),
        makeRule({ position: 2, name: "rule-2" }),
        makeRule({ position: 3, name: "rule-3" }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.totalRules).toBe(3);
    });

    it("should return empty issues array for a single benign rule", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "single-rule",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
          action: "permit",
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.issues).toHaveLength(0);
      expect(result.summary.shadows).toBe(0);
      expect(result.summary.overlaps).toBe(0);
      expect(result.summary.redundant).toBe(0);
      expect(result.summary.conflicts).toBe(0);
      expect(result.summary.permissive).toBe(0);
    });

    it("should handle empty ruleset", () => {
      const result = analyzeRuleset([]);
      expect(result.totalRules).toBe(0);
      expect(result.issues).toHaveLength(0);
    });

    it("should sort rules by position before analysis", () => {
      // Provide rules out of order
      const rules: NormalizedRule[] = [
        makeRule({
          position: 3,
          name: "deny-specific",
          action: "deny",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
        makeRule({
          position: 1,
          name: "permit-all",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "permit-narrow",
          action: "permit",
          sources: ["192.0.2.0/24"],
          destinations: ["203.0.113.0/24"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      // Rule 1 (permit-all) should shadow rules 2 and 3 despite input order
      expect(result.summary.permissive).toBe(1);
      // Rules 2 and 3 are shadowed by rule 1
      const shadowOrConflict = result.issues.filter(
        (i) => i.type === "shadow" || i.type === "conflict",
      );
      expect(shadowOrConflict.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("zone-based filtering", () => {
    it("should not detect shadow between rules in different zones", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "zone-a-permit",
          sourceZone: "trust",
          destinationZone: "untrust",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "zone-b-permit",
          sourceZone: "dmz",
          destinationZone: "trust",
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      // Different zones, so no shadow
      expect(result.summary.shadows).toBe(0);
      expect(result.summary.conflicts).toBe(0);
    });

    it("should detect shadow between rules with matching zones", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "broad-permit",
          sourceZone: "trust",
          destinationZone: "untrust",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "narrow-permit",
          sourceZone: "trust",
          destinationZone: "untrust",
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      expect(result.summary.shadows).toBeGreaterThanOrEqual(1);
    });

    it('should treat undefined zones (no zone) as "any" and match with any zone', () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "no-zone-permit",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "zoned-permit",
          sourceZone: "trust",
          destinationZone: "untrust",
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      // Rule without zones (defaults to 'any') should shadow the zoned rule
      expect(result.summary.shadows).toBeGreaterThanOrEqual(1);
    });
  });

  describe("issue properties", () => {
    it("should include recommendation text on shadow issues", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "broad",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "narrow",
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      const shadow = result.issues.find((i) => i.type === "shadow");
      expect(shadow).toBeDefined();
      expect(shadow!.recommendation).toBeTruthy();
      expect(shadow!.recommendation.length).toBeGreaterThan(0);
    });

    it("should include recommendation text on conflict issues", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "permit-broad",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "deny-narrow",
          action: "deny",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      const conflict = result.issues.find((i) => i.type === "conflict");
      expect(conflict).toBeDefined();
      expect(conflict!.recommendation).toBeTruthy();
    });

    it("should include rule name in the issue description", () => {
      const rules: NormalizedRule[] = [
        makeRule({
          position: 1,
          name: "Alpha-Rule",
          action: "permit",
          sources: ["any"],
          destinations: ["any"],
          services: ["any"],
        }),
        makeRule({
          position: 2,
          name: "Beta-Rule",
          action: "permit",
          sources: ["192.0.2.10/32"],
          destinations: ["203.0.113.10/32"],
          services: ["tcp/443"],
        }),
      ];

      const result = analyzeRuleset(rules);
      const shadow = result.issues.find((i) => i.type === "shadow");
      expect(shadow).toBeDefined();
      expect(shadow!.description).toContain("Beta-Rule");
      expect(shadow!.description).toContain("Alpha-Rule");
    });
  });
});
