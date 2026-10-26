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
import { updateRuleReviewSchema } from "@/lib/validators/project";
import type { UpdateRuleReviewInput } from "@/lib/validators/project";
import { RATE_LIMITS } from "@/lib/rateLimit";
import { statusAfterReview } from "@/lib/projectStatus";

/**
 * GET /api/v1/projects/[id]/rules/[ruleId]
 * Get a single normalized rule with its translated rule and full detail.
 */
export const GET = apiHandler(async ({ params, organizationId }) => {
  // Verify project ownership
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.id },
    select: { organizationId: true },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  const rule = await prisma.normalizedRule.findFirst({
    where: {
      id: params.ruleId,
      projectId: params.id,
    },
    include: {
      translatedRule: {
        include: {
          reviewedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  });

  if (!rule) return notFound("Rule not found");

  return NextResponse.json(rule);
});

/**
 * PATCH /api/v1/projects/[id]/rules/[ruleId]
 * Update the review status of a translated rule.
 * Sets reviewStatus, reviewedAt and reviewedById. manualOverride is stored for
 * MODIFIED and cleared for every other decision (approve = the generated
 * config); reviewerNote is kept unless the request sends one.
 */
export const PATCH = apiHandler<UpdateRuleReviewInput>(
  async ({ body, params, user, organizationId }) => {
    // Verify project ownership
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      select: { organizationId: true, status: true },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    // Find the normalized rule
    const rule = await prisma.normalizedRule.findFirst({
      where: {
        id: params.ruleId,
        projectId: params.id,
      },
      include: { translatedRule: true },
    });

    if (!rule) return notFound("Rule not found");

    if (!rule.translatedRule) {
      return badRequest(
        "Rule has not been translated yet. Translate the project first.",
      );
    }

    // Update the translated rule review
    const updatedTranslation = await prisma.translatedRule.update({
      where: { id: rule.translatedRule.id },
      data: {
        reviewStatus: body.reviewStatus,
        ...(body.reviewerNote !== undefined && {
          reviewerNote: body.reviewerNote.trim() || null,
        }),
        manualOverride: body.reviewStatus === "MODIFIED" ? body.manualOverride!.trim() : null,
        reviewedAt: new Date(),
        reviewedById: user.id,
      },
    });

    // Reviewing while rules are open, Approved once every rule has a decision
    const [total, pending] = await Promise.all([
      prisma.translatedRule.count({ where: { projectId: params.id } }),
      prisma.translatedRule.count({
        where: { projectId: params.id, reviewStatus: "PENDING" },
      }),
    ]);
    const status = statusAfterReview(project.status, pending, total);
    if (status !== project.status) {
      await prisma.migrationProject.update({
        where: { id: params.id },
        data: { status },
      });
      await recordStatusChange(params.id, status, user.id);
    }

    logger.info("Rule review updated", {
      projectId: params.id,
      ruleId: params.ruleId,
      translatedRuleId: updatedTranslation.id,
      reviewStatus: body.reviewStatus,
    });

    // Return the full rule with updated translation
    const updatedRule = await prisma.normalizedRule.findUnique({
      where: { id: params.ruleId },
      include: {
        translatedRule: {
          include: {
            reviewedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    return NextResponse.json(updatedRule);
  },
  {
    schema: updateRuleReviewSchema,
    // Reviewers click through rules quickly: count per user, with a high ceiling
    rateLimit: RATE_LIMITS.review,
    rateLimitPrefix: "review",
    rateLimitBy: "user",
  },
);
