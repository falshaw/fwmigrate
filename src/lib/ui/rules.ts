/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * UI helpers for rule review: loading every rule of a project and the
 * ok / flag / risk state shown on badges.
 */

/** The rules API caps `limit` at 200. */

export class RulesLoadError extends Error {
  constructor(
    public page: number,
    public status: number,
  ) {
    super(`Failed to load rules (page ${page}, HTTP ${status})`);
  }
}

export const RULES_PAGE_SIZE = 200;

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

interface RulesPage<T> {
  rules?: T[];
  total?: number;
}

/**
 * Load all normalized rules of a project, page by page. The API returns
 * 50 rules by default, so a single call silently drops the rest; the
 * reviewed count and the export gate need every rule.
 */
export async function fetchAllRules<T>(
  projectId: string,
  fetchFn: FetchLike = fetch,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchFn(
      `/api/v1/projects/${projectId}/rules?page=${page}&limit=${RULES_PAGE_SIZE}`,
    );
    if (!res.ok) throw new RulesLoadError(page, (res as { status?: number }).status ?? 0);
    const data = (await res.json()) as RulesPage<T>;
    const rules = data.rules ?? [];
    all.push(...rules);
    const total = data.total ?? all.length;
    if (rules.length === 0 || all.length >= total) return all;
  }
}

export type RuleState = "risk" | "flag" | "ok";

export interface RuleStateInput {
  isOverlyPermissive?: boolean | null;
  riskScore?: number | null;
  warnings?: string[] | null;
  /** Findings of the analysis step ("Shadow: …"), joined with " | " */
  analysisNotes?: string | null;
}

/** Risk score is 1-10 from the analysis step; 7+ counts as risky. */
export const RISKY_SCORE = 7;

export function isRisky(r: RuleStateInput): boolean {
  return !!r.isOverlyPermissive || (r.riskScore ?? 0) >= RISKY_SCORE;
}

/**
 * risk = over-permissive or high risk score; flag = the translator asks for
 * review or the analysis found something (duplicate, overlap, …).
 */
export function ruleState(r: RuleStateInput): RuleState {
  if (isRisky(r)) return "risk";
  if ((r.warnings ?? []).some((w) => w.startsWith("REVIEW:"))) return "flag";
  if (r.analysisNotes?.trim()) return "flag";
  return "ok";
}

export const RULE_STATE_BADGE: Record<RuleState, string> = {
  risk: "b-red",
  flag: "b-amber",
  ok: "b-teal",
};

/** Badge for a rule's human review decision. */
export const REVIEW_STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  PENDING: { cls: "b-grey", label: "Pending" },
  APPROVED: { cls: "b-teal", label: "Approved" },
  MODIFIED: { cls: "b-blue", label: "Modified" },
  SKIPPED: { cls: "b-grey", label: "Skipped" },
  FLAGGED: { cls: "b-red", label: "Flagged" },
};

/** Badge for a project status. */
export function projectStatusBadge(status: string): { cls: string; label: string } {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  if (["APPROVED", "EXPORTED"].includes(status)) return { cls: "b-teal", label };
  if (["REVIEWING", "TRANSLATED"].includes(status)) return { cls: "b-amber", label };
  if (["CREATED", "ARCHIVED"].includes(status)) return { cls: "b-grey", label };
  return { cls: "b-blue", label };
}
