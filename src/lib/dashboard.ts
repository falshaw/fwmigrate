/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Overview data, read straight from the database for one organization.
 * Every number on the overview comes from here; nothing is estimated.
 */

import prisma from "@/lib/prisma";
import { ruleState, RISKY_SCORE, type RuleState } from "@/lib/ui/rules";

export interface OverviewProject {
  id: string;
  name: string;
  sourceVendor: string;
  targetVendor: string;
  status: string;
  ruleCount: number;
  updatedAt: string;
  translated: number;
  approved: number;
  flagged: number;
  pending: number;
}

export interface QueueItem {
  id: string;
  ruleId: string;
  projectId: string;
  projectName: string;
  position: number;
  name: string;
  detail: string;
  confidence: number;
  state: RuleState | "flagged";
}

export interface OverviewData {
  projects: OverviewProject[];
  totals: { rules: number; pending: number; risky: number };
  /** Rule reviews per day, oldest first, last 7 days including today. */
  activity: { date: string; count: number }[];
  queue: QueueItem[];
  pairs: { source: string; target: string; projects: number }[];
}

const QUEUE_SIZE = 6;
const QUEUE_SCAN = 500;

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

export async function loadOverview(organizationId: string): Promise<OverviewData> {
  const inOrg = { project: { organizationId } };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 6);

  const [projects, counts, risky, reviewed, open] = await Promise.all([
    prisma.migrationProject.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        sourceVendor: true,
        targetVendor: true,
        status: true,
        ruleCount: true,
        updatedAt: true,
      },
    }),
    prisma.translatedRule.groupBy({
      by: ["projectId", "reviewStatus"],
      where: inOrg,
      _count: { _all: true },
    }),
    prisma.normalizedRule.count({
      where: {
        ...inOrg,
        OR: [{ isOverlyPermissive: true }, { riskScore: { gte: RISKY_SCORE } }],
      },
    }),
    prisma.translatedRule.findMany({
      where: { ...inOrg, reviewedAt: { gte: since } },
      select: { reviewedAt: true },
    }),
    prisma.translatedRule.findMany({
      where: { ...inOrg, reviewStatus: { in: ["PENDING", "FLAGGED"] } },
      orderBy: { project: { updatedAt: "desc" } },
      take: QUEUE_SCAN,
      select: {
        id: true,
        projectId: true,
        normalizedRuleId: true,
        warnings: true,
        confidence: true,
        reviewStatus: true,
        project: { select: { name: true } },
        normalizedRule: {
          select: {
            position: true,
            name: true,
            action: true,
            sources: true,
            destinations: true,
            isOverlyPermissive: true,
            riskScore: true,
          },
        },
      },
    }),
  ]);

  const byProject = new Map<string, Record<string, number>>();
  for (const c of counts) {
    const m = byProject.get(c.projectId) ?? {};
    m[c.reviewStatus] = c._count._all;
    byProject.set(c.projectId, m);
  }

  const overviewProjects: OverviewProject[] = projects.map((p) => {
    const m = byProject.get(p.id) ?? {};
    const translated = Object.values(m).reduce((a, b) => a + b, 0);
    return {
      id: p.id,
      name: p.name,
      sourceVendor: p.sourceVendor,
      targetVendor: p.targetVendor,
      status: p.status,
      ruleCount: p.ruleCount,
      updatedAt: p.updatedAt.toISOString(),
      translated,
      approved: (m.APPROVED ?? 0) + (m.MODIFIED ?? 0),
      flagged: m.FLAGGED ?? 0,
      pending: m.PENDING ?? 0,
    };
  });

  const perDay = new Map<string, number>();
  for (const r of reviewed) {
    if (!r.reviewedAt) continue;
    const k = dayKey(r.reviewedAt);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const activity = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const k = dayKey(d);
    return { date: k, count: perDay.get(k) ?? 0 };
  });

  // Review queue: rules a human flagged, then risky rules, then rules the
  // translator marked for review. Clean pending rules are not listed.
  const rank = { flagged: 0, risk: 1, flag: 2, ok: 3 } as const;
  const queue: QueueItem[] = open
    .map((t) => {
      const n = t.normalizedRule;
      const warnings = asStrings(t.warnings);
      const state: QueueItem["state"] =
        t.reviewStatus === "FLAGGED"
          ? "flagged"
          : ruleState({
              isOverlyPermissive: n.isOverlyPermissive,
              riskScore: n.riskScore,
              warnings,
            });
      const review = warnings.find((w) => w.startsWith("REVIEW:"));
      const detail = review
        ? review.replace(/^REVIEW:\s*/, "")
        : `${n.action} ${asStrings(n.sources).join(", ") || "any"} → ${
            asStrings(n.destinations).join(", ") || "any"
          }`;
      return {
        id: t.id,
        ruleId: t.normalizedRuleId,
        projectId: t.projectId,
        projectName: t.project.name,
        position: n.position,
        name: n.name,
        detail,
        confidence: t.confidence,
        state,
      };
    })
    .filter((q) => q.state !== "ok")
    .sort((a, b) => rank[a.state] - rank[b.state] || a.position - b.position)
    .slice(0, QUEUE_SIZE);

  const pairMap = new Map<string, { source: string; target: string; projects: number }>();
  for (const p of projects) {
    const k = `${p.sourceVendor}>${p.targetVendor}`;
    const e = pairMap.get(k) ?? { source: p.sourceVendor, target: p.targetVendor, projects: 0 };
    e.projects += 1;
    pairMap.set(k, e);
  }

  return {
    projects: overviewProjects,
    totals: {
      rules: projects.reduce((s, p) => s + p.ruleCount, 0),
      pending: overviewProjects.reduce((s, p) => s + p.pending, 0),
      risky,
    },
    activity,
    queue,
    pairs: [...pairMap.values()].sort((a, b) => b.projects - a.projects),
  };
}

