/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { recordStatusChange } from "@/lib/projectHistory";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { updateProjectSchema } from "@/lib/validators/project";
import { cancelExplainJob } from "@/lib/ai/explainJobs";

/**
 * GET /api/v1/projects/[id]
 * Retrieve a single project with full details including source config,
 * and counts for normalized rules, translated rules, analysis results, and zone mappings.
 */
export const GET = apiHandler(async ({ params, organizationId, user }) => {
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

  // Deleting is admin-only (see DELETE); the UI shows the button from this flag
  return NextResponse.json({ ...project, canDelete: user.role === "ADMIN" });
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
      await recordStatusChange(params.id, validated.status, user.id);
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

    // Cascades to every project table (source config, rules, objects, NAT,
    // analysis, translations, zone mappings, plan, validations, versions)
    cancelExplainJob(params.id);
    await prisma.migrationProject.delete({ where: { id: params.id } });

    logger.info("Project deleted", { projectId: params.id });

    return NextResponse.json({ deleted: true });
  },
  { roles: ["ADMIN"] },
);
