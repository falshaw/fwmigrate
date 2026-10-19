/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { analyzeRuleset } from "@/lib/analysis/RuleAnalysisEngine";
import { toNormalizedRules } from "@/lib/mappers/ruleMapper";
import type { NormalizedRule } from "@/lib/parsers/types";

/**
 * GET /api/v1/projects/[id]/analyze
 * Return existing analysis results and rule count for the project.
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

    const results = await prisma.analysisResult.findMany({
      where: { projectId: params.id },
      orderBy: [{ severity: "asc" }, { category: "asc" }],
    });

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

/**
 * POST /api/v1/projects/[id]/analyze
 * Run rule analysis on all parsed normalized rules.
 * Detects shadows, overlaps, conflicts, redundancies, and overly permissive rules.
 * Creates AnalysisResult records and updates rule-level flags.
 */
export const POST = apiHandler(
  async ({ params, organizationId }) => {
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      include: {
        normalizedRules: { orderBy: { position: "asc" } },
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

    await prisma.migrationProject.update({
      where: { id: params.id },
      data: { status: "ANALYZING" },
    });

    // Convert Prisma records to NormalizedRule type
    const rules: NormalizedRule[] = toNormalizedRules(project.normalizedRules);

    const analysis = analyzeRuleset(rules);

    // Delete old analysis results for this project
    await prisma.analysisResult.deleteMany({ where: { projectId: params.id } });

    // Create new analysis result records
    if (analysis.issues.length > 0) {
      await prisma.analysisResult.createMany({
        data: analysis.issues.map((issue) => ({
          projectId: params.id,
          category: issue.type,
          severity: issue.severity,
          ruleId: String(issue.rulePosition),
          title: `${issue.type.charAt(0).toUpperCase() + issue.type.slice(1)} detected: ${issue.ruleName}`,
          description: issue.description,
          recommendation: issue.recommendation,
        })),
      });
    }

    // Build a map of rule positions to their analysis flags
    const shadowedPositions = new Set<number>();
    const permissivePositions = new Set<number>();
    const riskScores = new Map<number, number>();
    const analysisNotes = new Map<number, string[]>();

    for (const issue of analysis.issues) {
      const pos = issue.rulePosition;

      if (!analysisNotes.has(pos)) analysisNotes.set(pos, []);
      analysisNotes.get(pos)!.push(issue.description);

      if (issue.type === "shadow") shadowedPositions.add(pos);
      if (issue.type === "permissive") permissivePositions.add(pos);

      // Risk score: critical=10, high=8, medium=5, low=3, info=1
      const severityScore =
        issue.severity === "critical"
          ? 10
          : issue.severity === "high"
            ? 8
            : issue.severity === "medium"
              ? 5
              : issue.severity === "low"
                ? 3
                : 1;

      const current = riskScores.get(pos) ?? 0;
      riskScores.set(pos, Math.max(current, severityScore));
    }

    // Update rule flags in batch
    const updatePromises = project.normalizedRules.map((r) => {
      const notes = analysisNotes.get(r.position);
      if (
        !notes &&
        !shadowedPositions.has(r.position) &&
        !permissivePositions.has(r.position)
      ) {
        return null;
      }
      return prisma.normalizedRule.update({
        where: { id: r.id },
        data: {
          isShadowed: shadowedPositions.has(r.position),
          isOverlyPermissive: permissivePositions.has(r.position),
          riskScore: riskScores.get(r.position) ?? null,
          analysisNotes: notes ? notes.join(" | ") : null,
        },
      });
    });

    await Promise.all(updatePromises.filter(Boolean));

    // Update project status
    await prisma.migrationProject.update({
      where: { id: params.id },
      data: { status: "ANALYZED" },
    });

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
    });
  },
  { rateLimit: { interval: 60_000, limit: 10 }, rateLimitPrefix: "analyze" },
);
