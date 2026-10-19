/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * POST /api/v1/validate/[projectId] — Validate a project's translated output
 * GET  /api/v1/validate/[projectId] — Get stored validation results
 * FM-04: Config Validation Engine
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { validateConfig } from "@/lib/validation/ConfigValidator";
import { logger } from "@/lib/logger";

export const POST = apiHandler(async ({ params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.projectId },
    include: {
      translatedRules: {
        include: {
          normalizedRule: {
            select: { position: true, name: true },
          },
        },
        orderBy: { normalizedRule: { position: "asc" } },
      },
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

  // Build combined config from translated rules
  const configLines: string[] = [];
  for (const tr of project.translatedRules) {
    const config =
      tr.reviewStatus === "MODIFIED" && tr.manualOverride
        ? tr.manualOverride
        : tr.targetConfig;
    configLines.push(config);
    configLines.push("");
  }
  const combinedConfig = configLines.join("\n");

  // Run validation
  const result = validateConfig(combinedConfig, project.targetVendor);

  // Enrich issues with rule names where possible
  const enrichedIssues = result.issues.map((issue) => {
    if (issue.line) {
      // Find which translated rule this line belongs to
      let currentLine = 0;
      for (const tr of project.translatedRules) {
        const config =
          tr.reviewStatus === "MODIFIED" && tr.manualOverride
            ? tr.manualOverride
            : tr.targetConfig;
        const ruleLines = config.split("\n").length + 1; // +1 for the blank line
        if (issue.line <= currentLine + ruleLines) {
          return {
            ...issue,
            rule: tr.normalizedRule?.name || undefined,
          };
        }
        currentLine += ruleLines;
      }
    }
    return issue;
  });

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
    rulesValidated: project.translatedRules.length,
  };

  logger.info("Project config validation completed", {
    projectId: project.id,
    vendor: project.targetVendor,
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  });

  return NextResponse.json(enrichedResult);
});

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
