/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Rule Analysis Engine — detects shadows, overlaps, redundancies, conflicts
 */

import type { NormalizedRule } from "../parsers/types";
import {
  compareAddresses,
  compareServices,
  calculateOverlapPercentage,
} from "./NetworkUtils";

export type IssueSeverity = "critical" | "high" | "medium" | "low" | "info";
export type IssueType =
  | "shadow"
  | "overlap"
  | "redundant"
  | "conflict"
  | "permissive";

export interface RuleIssue {
  type: IssueType;
  severity: IssueSeverity;
  rulePosition: number;
  ruleName: string;
  relatedRulePosition?: number;
  relatedRuleName?: string;
  description: string;
  recommendation: string;
}

export interface AnalysisOutput {
  totalRules: number;
  issues: RuleIssue[];
  summary: {
    shadows: number;
    overlaps: number;
    redundant: number;
    conflicts: number;
    permissive: number;
  };
}

export function analyzeRuleset(rules: NormalizedRule[]): AnalysisOutput {
  const sorted = [...rules].sort((a, b) => a.position - b.position);
  const issues: RuleIssue[] = [];

  // Detect overly permissive rules
  for (const rule of sorted) {
    if (!rule.enabled) continue;
    const isAnyAny =
      rule.sources.includes("any") &&
      rule.destinations.includes("any") &&
      rule.services.includes("any");
    if (isAnyAny && rule.action === "permit") {
      issues.push({
        type: "permissive",
        severity: "critical",
        rulePosition: rule.position,
        ruleName: rule.name,
        description: `Rule "${rule.name}" permits ALL traffic (any/any/any)`,
        recommendation:
          "Restrict source, destination, or service to reduce exposure",
      });
    }
  }

  // Detect shadows and conflicts
  for (let i = 1; i < sorted.length; i++) {
    const later = sorted[i];
    if (!later.enabled) continue;

    for (let j = 0; j < i; j++) {
      const earlier = sorted[j];
      if (!earlier.enabled) continue;

      // Zone check
      if (!zonesMatch(earlier, later)) continue;

      const srcCmp = compareAddresses(
        earlier.sources.join(","),
        later.sources.join(","),
      );
      const dstCmp = compareAddresses(
        earlier.destinations.join(","),
        later.destinations.join(","),
      );
      const svcCmp = compareServices(
        earlier.services.join(","),
        later.services.join(","),
      );

      if (srcCmp === "none" || dstCmp === "none" || svcCmp === "none") continue;

      const isShadowed =
        srcCmp === "contains" && dstCmp === "contains" && svcCmp === "contains";

      if (isShadowed) {
        const isConflict = earlier.action !== later.action;
        issues.push({
          type: isConflict ? "conflict" : "shadow",
          severity: isConflict ? "critical" : "high",
          rulePosition: later.position,
          ruleName: later.name,
          relatedRulePosition: earlier.position,
          relatedRuleName: earlier.name,
          description: isConflict
            ? `Rule "${later.name}" conflicts with earlier rule "${earlier.name}" (different actions on same traffic)`
            : `Rule "${later.name}" is fully shadowed by earlier rule "${earlier.name}" and will never match`,
          recommendation: isConflict
            ? "Review both rules — one may need to be removed or reordered"
            : `Consider removing rule "${later.name}" as it is dead`,
        });
        continue;
      }

      // Partial overlap
      if (
        (srcCmp === "overlaps" ||
          srcCmp === "contains" ||
          srcCmp === "contained") &&
        (dstCmp === "overlaps" ||
          dstCmp === "contains" ||
          dstCmp === "contained")
      ) {
        const pct = calculateOverlapPercentage(
          earlier.sources.join(","),
          later.sources.join(","),
        );
        if (pct >= 50) {
          issues.push({
            type: "overlap",
            severity: earlier.action !== later.action ? "high" : "medium",
            rulePosition: later.position,
            ruleName: later.name,
            relatedRulePosition: earlier.position,
            relatedRuleName: earlier.name,
            description: `Rule "${later.name}" overlaps ~${pct}% with rule "${earlier.name}"`,
            recommendation:
              earlier.action !== later.action
                ? "Different actions on overlapping traffic — review for correctness"
                : "Consider consolidating these rules",
          });
        }
      }

      // Redundancy (same action, very similar criteria)
      if (
        earlier.action === later.action &&
        srcCmp === "overlaps" &&
        dstCmp === "overlaps" &&
        svcCmp === "overlaps"
      ) {
        issues.push({
          type: "redundant",
          severity: "medium",
          rulePosition: later.position,
          ruleName: later.name,
          relatedRulePosition: earlier.position,
          relatedRuleName: earlier.name,
          description: `Rule "${later.name}" appears redundant with rule "${earlier.name}"`,
          recommendation: `Consider removing rule "${later.name}"`,
        });
      }
    }
  }

  return {
    totalRules: sorted.length,
    issues,
    summary: {
      shadows: issues.filter((i) => i.type === "shadow").length,
      overlaps: issues.filter((i) => i.type === "overlap").length,
      redundant: issues.filter((i) => i.type === "redundant").length,
      conflicts: issues.filter((i) => i.type === "conflict").length,
      permissive: issues.filter((i) => i.type === "permissive").length,
    },
  };
}

function zonesMatch(a: NormalizedRule, b: NormalizedRule): boolean {
  const szA = (a.sourceZone ?? "any").toLowerCase();
  const szB = (b.sourceZone ?? "any").toLowerCase();
  const dzA = (a.destinationZone ?? "any").toLowerCase();
  const dzB = (b.destinationZone ?? "any").toLowerCase();
  const srcMatch = szA === "any" || szB === "any" || szA === szB;
  const dstMatch = dzA === "any" || dzB === "any" || dzA === dzB;
  return srcMatch && dstMatch;
}
