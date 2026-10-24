/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { recordStatusChange } from "@/lib/projectHistory";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { analyzeRuleset, SEVERITY_RANK, type IssueSeverity } from "@/lib/analysis/RuleAnalysisEngine";
import { toNormalizedRules } from "@/lib/mappers/ruleMapper";
import type { NormalizedObject, NormalizedRule } from "@/lib/parsers/types";
import { advanceStatus } from "@/lib/projectStatus";

/**
 * GET /api/v1/projects/[id]/analyze
 * Existing analysis results (most severe first) and the rule count.
 */
export const GET = apiHandler(
  async ({ params, organizationId }) => {
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, ruleCount: true },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    const rank = (s: string) => SEVERITY_RANK[s as IssueSeverity] ?? 9;
    const results = (
      await prisma.analysisResult.findMany({ where: { projectId: params.id } })
    ).sort(
      (a, b) =>
        rank(a.severity) - rank(b.severity) ||
        Number(a.ruleId ?? 0) - Number(b.ruleId ?? 0),
    );

    return NextResponse.json({
      ruleCount: project.ruleCount,
      results,
    });
  },
  {
    rateLimit: { interval: 60_000, limit: 30 },
    rateLimitPrefix: "analyze-get",
  },
);

const SEVERITY_SCORE: Record<string, number> = {
  critical: 10,
  high: 8,
  medium: 5,
  low: 3,
  info: 1,
};

/**
 * POST /api/v1/projects/[id]/analyze
 * Resolve the rules' objects and groups, then find shadowed, duplicate,
 * redundant, conflicting, overlapping, overly permissive and disabled rules.
 * Replaces the project's analysis results and every rule's analysis flags.
 * Analysis does not change rules, so it never moves the project status back.
 */
export const POST = apiHandler(
  async ({ params, organizationId, user }) => {
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      include: {
        normalizedRules: { orderBy: { position: "asc" } },
        normalizedObjects: true,
      },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    if (project.normalizedRules.length === 0) {
      return badRequest(
        "No parsed rules to analyze. Parse a configuration first.",
      );
    }

    const rules: NormalizedRule[] = toNormalizedRules(project.normalizedRules);
    const objects: NormalizedObject[] = project.normalizedObjects.map((o) => ({
      objectType: o.objectType as NormalizedObject["objectType"],
      name: o.name,
      members: o.members as string[],
      rawVendorData: o.rawVendorData as Record<string, unknown> | undefined,
    }));

    const analysis = analyzeRuleset(rules, objects);

    // Per-rule flags, recomputed for every rule so stale flags never survive a re-run
    const flags = new Map<
      number,
      { notes: string[]; score: number; shadowed: boolean; permissive: boolean }
    >();
    for (const issue of analysis.issues) {
      const f = flags.get(issue.rulePosition) ?? {
        notes: [],
        score: 0,
        shadowed: false,
        permissive: false,
      };
      f.notes.push(issue.description);
      f.score = Math.max(f.score, SEVERITY_SCORE[issue.severity] ?? 1);
      // Never matches: shadowed, conflicting, or a duplicate of an earlier rule
      if (issue.type === "shadow" || issue.type === "conflict") f.shadowed = true;
      if (issue.type === "redundant" && issue.relatedRulePosition! < issue.rulePosition)
        f.shadowed = true;
      // "Risky" in review and on the overview: critical or high permissive findings only
      if (issue.type === "permissive" && (SEVERITY_SCORE[issue.severity] ?? 0) >= SEVERITY_SCORE.high)
        f.permissive = true;
      flags.set(issue.rulePosition, f);
    }

    const status = advanceStatus(project.status, "ANALYZED");

    await prisma.$transaction([
      prisma.analysisResult.deleteMany({ where: { projectId: params.id } }),
      prisma.analysisResult.createMany({
        data: analysis.issues.map((issue) => ({
          projectId: params.id,
          category: issue.type,
          severity: issue.severity,
          ruleId: String(issue.rulePosition),
          title:
            `${issue.type.charAt(0).toUpperCase() + issue.type.slice(1)}: #${issue.rulePosition} ${issue.ruleName}` +
            (issue.relatedRulePosition ? ` / #${issue.relatedRulePosition} ${issue.relatedRuleName}` : ""),
          description: issue.description,
          recommendation: issue.recommendation,
        })),
      }),
      ...project.normalizedRules.map((r) => {
        const f = flags.get(r.position);
        return prisma.normalizedRule.update({
          where: { id: r.id },
          data: {
            isUnused: !r.enabled,
            isShadowed: f?.shadowed ?? false,
            isOverlyPermissive: f?.permissive ?? false,
            riskScore: f ? f.score : null,
            analysisNotes: f ? f.notes.join(" | ") : null,
          },
        });
      }),
      ...(status !== project.status
        ? [
            prisma.migrationProject.update({
              where: { id: params.id },
              data: { status },
            }),
          ]
        : []),
    ]);

    if (status !== project.status) await recordStatusChange(params.id, status, user.id);

    // Build category counts
    const issuesByCategory: Record<string, number> = {};
    for (const issue of analysis.issues) {
      issuesByCategory[issue.type] = (issuesByCategory[issue.type] ?? 0) + 1;
    }

    logger.info("Analysis complete", {
      projectId: params.id,
      totalRules: analysis.totalRules,
      totalIssues: analysis.issues.length,
      summary: analysis.summary,
    });

    return NextResponse.json({
      totalRules: analysis.totalRules,
      issues: issuesByCategory,
      summary: analysis.summary,
      status,
    });
  },
  { rateLimit: { interval: 60_000, limit: 10 }, rateLimitPrefix: "analyze" },
);
