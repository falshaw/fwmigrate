/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound } from "@/lib/errors";

/**
 * GET /api/v1/projects/[id]/versions
 * Return version history for a project (FM-06).
 */
export const GET = apiHandler(async ({ params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.id },
    select: { organizationId: true },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  const versions = await prisma.projectVersion.findMany({
    where: { projectId: params.id },
    orderBy: { version: "desc" },
    include: {
      changedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ versions });
});
