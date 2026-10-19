/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import type { RuleReviewStatus } from "@/generated/prisma";

/**
 * GET /api/v1/projects/[id]/rules
 * List normalized rules for a project, with optional pagination and filtering.
 * Each rule includes its translated rule if one exists.
 *
 * Query params:
 *   page   - Page number (default: 1)
 *   limit  - Items per page (default: 50, max: 200)
 *   status - Filter by translated rule review status (PENDING, APPROVED, MODIFIED, SKIPPED, FLAGGED)
 *   sort   - Sort field (default: "position")
 */
export const GET = apiHandler(async ({ req, params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.id },
    select: { organizationId: true },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)),
  );
  const statusFilter = url.searchParams.get(
    "status",
  ) as RuleReviewStatus | null;
  const sort = url.searchParams.get("sort") ?? "position";
  const skip = (page - 1) * limit;

  // Build where clause
  const where: Record<string, unknown> = { projectId: params.id };

  // If filtering by review status, we need to join through translatedRule
  if (statusFilter) {
    where.translatedRule = { reviewStatus: statusFilter };
  }

  // Determine sort order
  const orderBy: Record<string, string> =
    sort === "name"
      ? { name: "asc" }
      : sort === "riskScore"
        ? { riskScore: "desc" }
        : { position: "asc" };

  const [rules, total] = await Promise.all([
    prisma.normalizedRule.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        translatedRule: {
          select: {
            id: true,
            targetConfig: true,
            targetVendor: true,
            explanation: true,
            warnings: true,
            confidence: true,
            reviewStatus: true,
            reviewerNote: true,
            manualOverride: true,
            reviewedAt: true,
          },
        },
      },
    }),
    prisma.normalizedRule.count({ where }),
  ]);

  return NextResponse.json({
    rules,
    total,
    page,
    limit,
  });
});
