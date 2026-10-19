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
import { updateRuleReviewSchema } from "@/lib/validators/project";
import type { UpdateRuleReviewInput } from "@/lib/validators/project";

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
 * Sets reviewStatus, reviewerNote, manualOverride, reviewedAt, and reviewedById.
 */
export const PATCH = apiHandler<UpdateRuleReviewInput>(
  async ({ body, params, user, organizationId }) => {
    // Verify project ownership
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      select: { organizationId: true },
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
        reviewerNote: body.reviewerNote ?? null,
        manualOverride: body.manualOverride ?? null,
        reviewedAt: new Date(),
        reviewedById: user.id,
      },
    });

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
  { schema: updateRuleReviewSchema },
);
