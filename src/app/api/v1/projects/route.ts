/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createProjectSchema } from "@/lib/validators/project";
import type { CreateProjectInput } from "@/lib/validators/project";

/**
 * GET /api/v1/projects
 * List all migration projects for the authenticated user's organization.
 * Returns projects ordered by most recently updated, with rule counts and status.
 */
export const GET = apiHandler(async ({ organizationId }) => {
  const projects = await prisma.migrationProject.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      sourceVendor: true,
      targetVendor: true,
      status: true,
      ruleCount: true,
      objectCount: true,
      natRuleCount: true,
      parseConfidence: true,
      createdAt: true,
      updatedAt: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  logger.info("Projects listed", { count: projects.length, organizationId });

  return NextResponse.json({ projects, total: projects.length });
});

/**
 * POST /api/v1/projects
 * Create a new migration project within the user's organization.
 */
export const POST = apiHandler<CreateProjectInput>(
  async ({ body, user, organizationId }) => {
    const project = await prisma.migrationProject.create({
      data: {
        name: body.name,
        description: body.description,
        sourceVendor: body.sourceVendor,
        targetVendor: body.targetVendor,
        organizationId,
        createdById: user.id,
      },
    });

    logger.info("Project created", {
      projectId: project.id,
      sourceVendor: body.sourceVendor,
      targetVendor: body.targetVendor,
    });

    return NextResponse.json(project, { status: 201 });
  },
  { schema: createProjectSchema },
);
