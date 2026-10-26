/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * POST /api/v1/validate/[projectId] — Validate a project's translated output
 * GET  /api/v1/validate/[projectId] — Get stored validation results
 * FM-04: Config Validation Engine
 */

import { NextResponse } from "next/server";
import { apiHandler, ALL_ROLES } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { validateConfig } from "@/lib/validation/ConfigValidator";
import { logger } from "@/lib/logger";
import { buildTargetConfig } from "@/lib/export/targetConfig";

export const POST = apiHandler(async ({ params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.projectId },
    include: {
      translatedRules: {
        include: { normalizedRule: true },
        orderBy: { normalizedRule: { position: "asc" } },
      },
      normalizedObjects: true,
      zoneMappings: true,
    },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  if (project.translatedRules.length === 0) {
    return badRequest(
      "No translated rules to validate. Translate rules first.",
    );
  }

  // Validate what the export would produce: the approved rules once the
  // review has started, every translated rule before that. Objects included,
  // so references can be checked.
  const approved = project.translatedRules.filter((t) =>
    ["APPROVED", "MODIFIED"].includes(t.reviewStatus),
  );
  const scope = approved.length ? approved : project.translatedRules;
  const { config } = await buildTargetConfig({
    targetVendor: project.targetVendor,
    translatedRules: scope,
    normalizedObjects: project.normalizedObjects,
    zoneMappings: project.zoneMappings,
  });

  const result = validateConfig(config, project.targetVendor);
  const enrichedIssues = result.issues;

  const errorIssues = enrichedIssues.filter((i) => i.severity === "error");
  const warningIssues = enrichedIssues.filter((i) => i.severity === "warning");

  // Persist validation result
  await prisma.validationResult.create({
    data: {
      projectId: project.id,
      status: result.valid ? "passed" : "failed",
      vendor: project.targetVendor,
      totalChecks: result.totalChecks,
      errorCount: result.errors,
      warningCount: result.warnings,
      errors: errorIssues as object,
      warnings: warningIssues as object,
    },
  });

  const enrichedResult = {
    ...result,
    issues: enrichedIssues,
    projectId: project.id,
    projectName: project.name,
    targetVendor: project.targetVendor,
    rulesValidated: scope.length,
    scope: approved.length ? "approved" : "translated",
  };

  logger.info("Project config validation completed", {
    projectId: project.id,
    vendor: project.targetVendor,
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  });

  return NextResponse.json(enrichedResult);
  // A check with a history entry; it changes no project data, so viewers may run it
}, { roles: ALL_ROLES });

export const GET = apiHandler(async ({ params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.projectId },
    select: { id: true, organizationId: true, name: true, targetVendor: true },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  const results = await prisma.validationResult.findMany({
    where: { projectId: params.projectId },
    orderBy: { validatedAt: "desc" },
  });

  return NextResponse.json({
    projectId: project.id,
    projectName: project.name,
    targetVendor: project.targetVendor,
    results,
    latestResult: results[0] || null,
  });
});
