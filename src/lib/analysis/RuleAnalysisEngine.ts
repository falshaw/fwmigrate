/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Rule Analysis Engine: shadowed, duplicate, redundant, conflicting,
 * overlapping and overly permissive rules, plus disabled rules and rules
 * that reference undefined objects.
 *
 * Every rule is first resolved (ObjectResolver): address objects, nested
 * address groups, service objects/groups and PAN-OS App-IDs become IPv4
 * ranges and port ranges. Comparisons run on those sets, inside one zone
 * pair and, for Cisco ASA, inside one access list.
 */

import type { NormalizedObject, NormalizedRule } from "../parsers/types";
import {
  ObjectIndex,
  addressCovers,
  addressIntersects,
  resolveRule,
  serviceCovers,
  serviceIntersects,
  serviceIsAny,
  type ResolvedRule,
} from "./ObjectResolver";

export type IssueSeverity = "critical" | "high" | "medium" | "low" | "info";
export type IssueType =
  | "shadow"
  | "overlap"
  | "redundant"
  | "conflict"
  | "permissive"
  | "disabled"
  | "unresolved";

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
    disabled: number;
    unresolved: number;
  };
}

export const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

function zone(z: string | undefined): string {
  const v = (z ?? "").trim().toLowerCase();
  return v === "" || v === "any" ? "any" : v;
}

function zoneCovers(a: string | undefined, b: string | undefined): boolean {
  const za = zone(a);
  return za === "any" || za === zone(b);
}

function zoneIntersects(a: string | undefined, b: string | undefined): boolean {
  const za = zone(a);
  const zb = zone(b);
  return za === "any" || zb === "any" || za === zb;
}

// ---------------------------------------------------------------------------
// Rule-level relations
// ---------------------------------------------------------------------------

/** a matches every packet b matches. */
function covers(a: ResolvedRule, b: ResolvedRule): boolean {
  return (
    zoneCovers(a.rule.sourceZone, b.rule.sourceZone) &&
    zoneCovers(a.rule.destinationZone, b.rule.destinationZone) &&
    addressCovers(a.src, b.src) &&
    addressCovers(a.dst, b.dst) &&
    serviceCovers(a.svc, b.svc)
  );
}

/** Some packet matches both. Unresolved names never count as a match. */
function intersects(a: ResolvedRule, b: ResolvedRule): boolean {
  return (
    zoneIntersects(a.rule.sourceZone, b.rule.sourceZone) &&
    zoneIntersects(a.rule.destinationZone, b.rule.destinationZone) &&
    addressIntersects(a.src, b.src) &&
    addressIntersects(a.dst, b.dst) &&
    serviceIntersects(a.svc, b.svc)
  );
}

const allows = (r: NormalizedRule) => r.action === "permit";
/** deny and drop both block; only permit vs block is a different outcome. */
const sameOutcome = (a: NormalizedRule, b: NormalizedRule) => allows(a) === allows(b);

const VERB: Record<string, string> = { permit: "permits", deny: "denies", drop: "drops" };

function q(name: string) {
  return `"${name}"`;
}

/** any zone, any source, any destination, any service */
function isCatchAll(r: ResolvedRule): boolean {
  return (
    zone(r.rule.sourceZone) === "any" &&
    zone(r.rule.destinationZone) === "any" &&
    r.src.any &&
    r.dst.any &&
    serviceIsAny(r.svc)
  );
}

function permissiveIssue(r: ResolvedRule): RuleIssue | null {
  const rule = r.rule;
  if (!allows(rule)) return null;
  const srcAny = r.src.any;
  const dstAny = r.dst.any;
  const svcAny = serviceIsAny(r.svc);
  const base = { type: "permissive" as const, rulePosition: rule.position, ruleName: rule.name };

  if (srcAny && dstAny && svcAny)
    return {
      ...base,
      severity: "critical",
      description: `Rule ${q(rule.name)} permits ALL traffic (any source, any destination, any service)`,
      recommendation: "Restrict source, destination and service to what the traffic really needs",
    };
  if (svcAny && (srcAny || dstAny))
    return {
      ...base,
      severity: "high",
      description: `Rule ${q(rule.name)} permits every service ${srcAny ? "from any source" : "to any destination"}`,
      recommendation: "Limit the rule to the services that are actually used",
    };
  if (srcAny && dstAny)
    return {
      ...base,
      severity: "medium",
      description: `Rule ${q(rule.name)} permits its services from any source to any destination`,
      recommendation: "Restrict the source or destination",
    };
  if (svcAny)
    return {
      ...base,
      severity: "low",
      description: `Rule ${q(rule.name)} permits every service between its source and destination`,
      recommendation: "Limit the rule to the services that are actually used",
    };
  return null;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export function analyzeRuleset(
  rules: NormalizedRule[],
  objects: NormalizedObject[] = [],
): AnalysisOutput {
  const index = new ObjectIndex(objects);
  const sorted = [...rules].sort((a, b) => a.position - b.position);
  const issues: RuleIssue[] = [];

  const resolved = sorted.map((r) => resolveRule(r, index));
  const active = resolved.filter((r) => r.rule.enabled);

  for (const r of resolved) {
    if (!r.rule.enabled) {
      issues.push({
        type: "disabled",
        severity: "info",
        rulePosition: r.rule.position,
        ruleName: r.rule.name,
        description: `Rule ${q(r.rule.name)} is disabled and matches no traffic`,
        recommendation: "Leave it out of the migration, or document why it is kept",
      });
      continue;
    }
    if (r.unresolved.length) {
      issues.push({
        type: "unresolved",
        severity: "info",
        rulePosition: r.rule.position,
        ruleName: r.rule.name,
        description: `Rule ${q(r.rule.name)} references names that are not defined in the configuration: ${r.unresolved.join(", ")}. The checks treat them as unknown.`,
        recommendation: "Add the missing objects to the source config or check the export",
      });
    }
    const p = permissiveIssue(r);
    if (p) issues.push(p);
  }

  /** Rules that never match (shadowed, duplicate, conflicting); later checks skip them. */
  const hidden = new Set<ResolvedRule>();

  for (let j = 0; j < active.length; j++) {
    const later = active[j];
    let covered = false;

    // 1. Shadow / duplicate / conflict: an earlier rule matches everything this one matches.
    for (let i = 0; i < j; i++) {
      const earlier = active[i];
      if (earlier.scope !== later.scope) continue;
      if (hidden.has(earlier) || !covers(earlier, later)) continue;
      covered = true;
      hidden.add(later);
      const e = earlier.rule;
      const l = later.rule;
      if (!sameOutcome(e, l)) {
        issues.push({
          type: "conflict",
          severity: "critical",
          rulePosition: l.position,
          ruleName: l.name,
          relatedRulePosition: e.position,
          relatedRuleName: e.name,
          description: `Rule ${q(l.name)} (${l.action}) never matches: earlier rule ${q(e.name)} (${e.action}) already matches all of its traffic with the opposite action`,
          recommendation: `Decide which action is intended; move ${q(l.name)} above ${q(e.name)} or remove it`,
        });
      } else if (covers(later, earlier)) {
        issues.push({
          type: "redundant",
          severity: "medium",
          rulePosition: l.position,
          ruleName: l.name,
          relatedRulePosition: e.position,
          relatedRuleName: e.name,
          description: `Rule ${q(l.name)} matches exactly the same traffic as earlier rule ${q(e.name)} (duplicate)`,
          recommendation: `Remove ${q(l.name)}`,
        });
      } else {
        issues.push({
          type: "shadow",
          severity: "high",
          rulePosition: l.position,
          ruleName: l.name,
          relatedRulePosition: e.position,
          relatedRuleName: e.name,
          description: `Rule ${q(l.name)} is fully shadowed by earlier rule ${q(e.name)} and never matches`,
          recommendation: `Remove ${q(l.name)} or move it above ${q(e.name)} if its settings (logging, profiles) matter`,
        });
      }
      break; // report the first rule that hides it
    }
    if (covered) continue;

    for (let i = 0; i < j; i++) {
      const earlier = active[i];
      if (earlier.scope !== later.scope || hidden.has(earlier)) continue;
      const e = earlier.rule;
      const l = later.rule;

      // 2. Redundant: a later rule with the same action already matches everything
      //    the earlier one does, and nothing in between treats that traffic differently.
      // An explicit block above the final block-everything rule is deliberate
      // (it documents and logs the intent), so that pair is not reported.
      if (sameOutcome(e, l) && covers(later, earlier)) {
        if (!allows(l) && isCatchAll(later)) continue;
        const between = active.slice(i + 1, j);
        const blocked = between.some(
          (m) =>
            m.scope === earlier.scope &&
            !hidden.has(m) &&
            !sameOutcome(m.rule, e) &&
            intersects(m, earlier),
        );
        if (!blocked) {
          issues.push({
            type: "redundant",
            severity: "low",
            rulePosition: e.position,
            ruleName: e.name,
            relatedRulePosition: l.position,
            relatedRuleName: l.name,
            description: `Rule ${q(e.name)} is redundant: later rule ${q(l.name)} ${VERB[l.action] ?? l.action} all of its traffic as well`,
            recommendation: `Remove ${q(e.name)}, or keep it only if it carries its own logging or profiles`,
          });
        }
        continue;
      }

      // 3. Partial overlap with the opposite action: rule order decides the outcome.
      //    (A narrow exception above a broad rule is normal and not reported.)
      if (!sameOutcome(e, l) && !covers(later, earlier) && intersects(earlier, later)) {
        issues.push({
          type: "overlap",
          severity: "medium",
          rulePosition: l.position,
          ruleName: l.name,
          relatedRulePosition: e.position,
          relatedRuleName: e.name,
          description: `Rule ${q(l.name)} (${l.action}) partly overlaps earlier rule ${q(e.name)} (${e.action}); for the shared traffic the earlier rule wins`,
          recommendation: "Check that the order gives the intended result, or split the rules so they no longer overlap",
        });
      }
    }
  }

  issues.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.rulePosition - b.rulePosition,
  );

  const count = (t: IssueType) => issues.filter((i) => i.type === t).length;
  return {
    totalRules: sorted.length,
    issues,
    summary: {
      shadows: count("shadow"),
      overlaps: count("overlap"),
      redundant: count("redundant"),
      conflicts: count("conflict"),
      permissive: count("permissive"),
      disabled: count("disabled"),
      unresolved: count("unresolved"),
    },
  };
}
