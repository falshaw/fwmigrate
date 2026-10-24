/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * GET /api/v1/batch/[id]/export — Download all batch results as combined text
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildTargetConfig } from "@/lib/export/targetConfig";
import { vendorLabel } from "@/lib/vendors";

interface BatchResult {
  filename: string;
  sourceVendor: string;
  targetVendor: string;
  status: string;
  projectId?: string;
  error?: string;
  ruleCount?: number;
}

export const GET = apiHandler(async ({ params, organizationId }) => {
  const batch = await prisma.batchMigration.findUnique({
    where: { id: params.id },
  });

  if (!batch) return notFound("Batch migration not found");
  if (batch.organizationId !== organizationId)
    return notFound("Batch migration not found");

  if (batch.status !== "completed") {
    return badRequest(
      "Batch migration has not completed yet. Run the batch first.",
    );
  }

  const results = batch.results as unknown as BatchResult[];
  const successResults = results.filter((r) => r.status === "success");

  if (successResults.length === 0) {
    return badRequest("No successful migrations to export.");
  }

  // Fetch all successful projects with their translated rules
  const projectIds = successResults
    .map((r) => r.projectId)
    .filter((id): id is string => !!id);

  const projects = await prisma.migrationProject.findMany({
    where: { id: { in: projectIds } },
    include: {
      translatedRules: {
        include: { normalizedRule: true },
        orderBy: { normalizedRule: { position: "asc" } },
      },
      normalizedObjects: true,
      zoneMappings: true,
    },
  });

  // Every section is a complete config in its target's own syntax (objects,
  // then rules) under that target's comment character. The file header uses
  // the shared comment character when all targets agree.
  const built = await Promise.all(
    projects.map(async (project) => ({
      project,
      ...(await buildTargetConfig({
        targetVendor: project.targetVendor,
        translatedRules: project.translatedRules,
        normalizedObjects: project.normalizedObjects,
        zoneMappings: project.zoneMappings,
      })),
    })),
  );
  const prefixes = new Set(built.map((b) => b.commentPrefix));
  const c = prefixes.size === 1 ? [...prefixes][0] : "#";

  const timestamp = new Date().toISOString();
  const sections: string[] = [];
  const line = (ch: string, p: string) => `${p} ${ch.repeat(76)}`;

  sections.push(line("=", c));
  sections.push(`${c} FW Migrate batch export: ${batch.name}`);
  sections.push(`${c} Generated: ${timestamp}`);
  sections.push(
    `${c} Configs: ${batch.totalConfigs}, translated: ${batch.completedCount}, failed: ${batch.failedCount}`,
  );
  sections.push(`${c} One section per config, each a complete config for its target (objects, then rules).`);
  sections.push(`${c} The rules are NOT reviewed. Open each project and review it before applying anything.`);
  sections.push(line("=", c));
  sections.push("");

  for (const { project, config, commentPrefix: p } of built) {
    sections.push(line("-", p));
    sections.push(`${p} Project: ${project.name}`);
    sections.push(`${p} Migration: ${vendorLabel(project.sourceVendor)} -> ${vendorLabel(project.targetVendor)}`);
    sections.push(`${p} Rules: ${project.translatedRules.length}`);
    sections.push(line("-", p));
    sections.push(config);
    sections.push("");
  }

  const failedResults = results.filter((r) => r.status === "failed");
  if (failedResults.length > 0) {
    sections.push(line("=", c));
    sections.push(`${c} Failed configs`);
    for (const f of failedResults) {
      sections.push(
        `${c} ${f.filename} (${vendorLabel(f.sourceVendor)} -> ${vendorLabel(f.targetVendor)}): ${f.error}`,
      );
    }
    sections.push(line("=", c));
    sections.push("");
  }

  const fullExport = sections.join("\n");

  const filename = `${batch.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_batch_export.txt`;

  logger.info("Batch export downloaded", {
    batchId: params.id,
    projectCount: projects.length,
  });

  return new NextResponse(fullExport, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
