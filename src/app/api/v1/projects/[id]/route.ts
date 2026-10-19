/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { updateProjectSchema } from "@/lib/validators/project";

/**
 * GET /api/v1/projects/[id]
 * Retrieve a single project with full details including source config,
 * and counts for normalized rules, translated rules, analysis results, and zone mappings.
 */
export const GET = apiHandler(async ({ params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.id },
    include: {
      sourceConfig: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      _count: {
        select: {
          normalizedRules: true,
          translatedRules: true,
          analysisResults: true,
          zoneMappings: true,
          normalizedObjects: true,
          normalizedNATRules: true,
        },
      },
    },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  return NextResponse.json(project);
});

/**
 * PATCH /api/v1/projects/[id]
 * Update project name, description, or status.
 */
export const PATCH = apiHandler(
  async ({ req, params, organizationId, user }) => {
    const existing = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      select: {
        organizationId: true,
        status: true,
        ruleCount: true,
        objectCount: true,
        natRuleCount: true,
        parseConfidence: true,
        _count: {
          select: { translatedRules: true },
        },
      },
    });

    if (!existing) return notFound("Project not found");
    if (existing.organizationId !== organizationId)
      return notFound("Project not found");

    const body = await req.json();
    const validated = updateProjectSchema.parse(body);

    if (Object.keys(validated).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    // FM-06: Auto-snapshot on status transition
    const statusChanged =
      "status" in validated && validated.status !== existing.status;

    const project = await prisma.migrationProject.update({
      where: { id: params.id },
      data: validated,
    });

    if (statusChanged && validated.status) {
      const versionCount = await prisma.projectVersion.count({
        where: { projectId: params.id },
      });
      await prisma.projectVersion.create({
        data: {
          projectId: params.id,
          version: versionCount + 1,
          fromStatus: existing.status,
          toStatus: validated.status,
          snapshot: {
            ruleCount: existing.ruleCount,
            objectCount: existing.objectCount,
            natRuleCount: existing.natRuleCount,
            parseConfidence: existing.parseConfidence,
            translatedCount: existing._count.translatedRules,
          },
          changedById: user.id,
        },
      });
    }

    logger.info("Project updated", {
      projectId: params.id,
      fields: Object.keys(validated),
    });

    return NextResponse.json(project);
  },
);

/**
 * DELETE /api/v1/projects/[id]
 * Delete a project and all related data (cascading).
 * Restricted to ADMIN role only.
 */
export const DELETE = apiHandler(
  async ({ params, organizationId }) => {
    const existing = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      select: { organizationId: true },
    });

    if (!existing) return notFound("Project not found");
    if (existing.organizationId !== organizationId)
      return notFound("Project not found");

    await prisma.migrationProject.delete({ where: { id: params.id } });

    logger.info("Project deleted", { projectId: params.id });

    return NextResponse.json({ deleted: true });
  },
  { roles: ["ADMIN"] },
);
