/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Project status rules. A step that is re-run without changing the rules
 * (re-analysis, an identical re-translation) never moves a project back,
 * e.g. from Exported to Analyzed. Only a real change does: new rules after
 * a re-import, or translations that came out different.
 */

export const STATUS_ORDER = [
  "CREATED",
  "IMPORTING",
  "PARSING",
  "PARSED",
  "ANALYZING",
  "ANALYZED",
  "TRANSLATING",
  "TRANSLATED",
  "REVIEWING",
  "APPROVED",
  "EXPORTED",
  "ARCHIVED",
] as const;

export type ProjectStatusName = (typeof STATUS_ORDER)[number];

const TRANSIENT = new Set<string>(["IMPORTING", "PARSING", "ANALYZING", "TRANSLATING"]);

export function statusRank(status: string): number {
  return STATUS_ORDER.indexOf(status as ProjectStatusName);
}

/**
 * Status after a step that does not change the rules: the step's own status
 * if the project has not got that far yet (or is stuck in a transient state),
 * otherwise the current status.
 */
export function advanceStatus(current: string, reached: ProjectStatusName): ProjectStatusName {
  if (TRANSIENT.has(current)) return reached;
  return statusRank(current) >= statusRank(reached) ? (current as ProjectStatusName) : reached;
}

/** Status after a review decision: Reviewing while rules are open, Approved once none is pending. */
export function statusAfterReview(current: string, pending: number, total: number): ProjectStatusName {
  if (total > 0 && pending === 0) return advanceStatus(current, "APPROVED");
  return advanceStatus(current, "REVIEWING");
}

export interface PreviousTranslation {
  normalizedRuleId: string;
  targetConfig: string;
  reviewStatus: string;
}

/**
 * Status after a translation run. When every rule produced the same config
 * as before and nothing was added or removed, the reviews are kept and so is
 * the status. Otherwise review restarts from Translated (or Reviewing when
 * some unchanged rules keep their decisions).
 */
export function statusAfterTranslate(
  current: string,
  previous: PreviousTranslation[],
  next: { normalizedRuleId: string; targetConfig: string }[],
): { status: ProjectStatusName; changed: number; kept: number } {
  const before = new Map(previous.map((p) => [p.normalizedRuleId, p]));
  let changed = 0;
  let kept = 0;
  let keptDecided = 0;
  for (const n of next) {
    const p = before.get(n.normalizedRuleId);
    if (p && p.targetConfig === n.targetConfig) {
      kept++;
      if (p.reviewStatus !== "PENDING") keptDecided++;
    } else changed++;
  }
  const removed = previous.length - kept;
  if (changed === 0 && removed === 0 && previous.length > 0) {
    const pending = previous.filter((p) => p.reviewStatus === "PENDING").length;
    const status =
      statusRank(current) >= statusRank("TRANSLATED") && !TRANSIENT.has(current)
        ? (current as ProjectStatusName)
        : pending === 0
          ? "APPROVED"
          : keptDecided > 0
            ? "REVIEWING"
            : "TRANSLATED";
    return { status, changed, kept };
  }
  return { status: keptDecided > 0 ? "REVIEWING" : "TRANSLATED", changed, kept };
}
