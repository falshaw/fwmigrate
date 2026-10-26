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
import { importConfigSchema } from "@/lib/validators/project";
import { getParser } from "@/lib/parsers/ParserFactory";
import type { FirewallVendor } from "@/lib/parsers/types";
import { vendorLabel } from "@/lib/vendors";
import type { ImportConfigInput } from "@/lib/validators/project";

/**
 * Detect config type from raw configuration text.
 * Checks for XML tags, JSON braces, Juniper "set " prefix, or Fortinet "config " blocks.
 */
function detectConfigType(rawConfig: string): "xml" | "json" | "set" | "text" {
  const trimmed = rawConfig.trimStart();

  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    return "xml";
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON, fall through
    }
  }

  const lines = trimmed.split("\n").slice(0, 20);
  const setLines = lines.filter((l) => l.trimStart().startsWith("set "));
  if (setLines.length >= 3) {
    return "set";
  }

  return "text";
}

// Security: Maximum config size (20MB) — enforced at route level as defense-in-depth
const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

/**
 * POST /api/v1/projects/[id]/import
 * Import a raw firewall configuration into the project.
 * Auto-detects configType if not provided.
 * Creates a SourceConfig record and updates project status to IMPORTING.
 */
export const POST = apiHandler<ImportConfigInput>(
  async ({ body, params, organizationId, user }) => {
    // Defense-in-depth: check raw config size before any DB operations
    const fileSize = Buffer.byteLength(body.rawConfig, "utf8");
    if (fileSize > MAX_IMPORT_SIZE) {
      return badRequest(
        `Config size ${(fileSize / (1024 * 1024)).toFixed(1)}MB exceeds maximum of ${MAX_IMPORT_SIZE / (1024 * 1024)}MB`,
      );
    }

    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, sourceVendor: true, sourceConfig: true },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    // Check the config with the project's parser before anything is stored or
    // replaced: a wrong-vendor or empty config changes nothing.
    const vendor = vendorLabel(project.sourceVendor);
    let ruleCount = 0;
    try {
      const probe = await getParser(project.sourceVendor as FirewallVendor).parse(body.rawConfig);
      ruleCount = probe.rules.length;
    } catch {
      ruleCount = 0;
    }
    if (ruleCount === 0) {
      return NextResponse.json(
        {
          error: `No security rules found. This does not look like a ${vendor} config, or it has no security policy. Import the right file, or create a project with the right source vendor.`,
        },
        { status: 422 },
      );
    }

    if (project.sourceConfig) {
      if (!body.replace) {
        return NextResponse.json(
          {
            error:
              "Project already has an imported config. Import again with replace to discard it and everything derived from it.",
          },
          { status: 409 },
        );
      }
      // Everything below was derived from the old config. Zone mappings and the
      // review history (versions) are kept.
      await prisma.$transaction([
        prisma.translatedRule.deleteMany({ where: { projectId: params.id } }),
        prisma.analysisResult.deleteMany({ where: { projectId: params.id } }),
        prisma.validationResult.deleteMany({ where: { projectId: params.id } }),
        prisma.migrationPlan.deleteMany({ where: { projectId: params.id } }),
        prisma.normalizedNATRule.deleteMany({ where: { projectId: params.id } }),
        prisma.normalizedObject.deleteMany({ where: { projectId: params.id } }),
        prisma.normalizedRule.deleteMany({ where: { projectId: params.id } }),
        prisma.sourceConfig.delete({ where: { projectId: params.id } }),
        prisma.migrationProject.update({
          where: { id: params.id },
          data: { ruleCount: 0, objectCount: 0, natRuleCount: 0, parseConfidence: null },
        }),
      ]);
      logger.info("Config replaced", { projectId: params.id });
      await recordStatusChange(
        params.id,
        "CREATED",
        user.id,
        "Parse, analysis, translation and review discarded",
        "Config replaced",
      );
    }

    const configType = body.configType || detectConfigType(body.rawConfig);
    const lineCount = body.rawConfig.split("\n").length;

    const sourceConfig = await prisma.sourceConfig.create({
      data: {
        projectId: params.id,
        rawConfig: body.rawConfig,
        configType,
        fileSize,
        lineCount,
      },
    });

    await prisma.migrationProject.update({
      where: { id: params.id },
      data: { status: "IMPORTING" },
    });

    logger.info("Config imported", {
      projectId: params.id,
      configType,
      fileSize,
      lineCount,
    });

    return NextResponse.json(
      {
        id: sourceConfig.id,
        projectId: sourceConfig.projectId,
        configType: sourceConfig.configType,
        fileSize: sourceConfig.fileSize,
        lineCount: sourceConfig.lineCount,
      },
      { status: 201 },
    );
  },
  {
    schema: importConfigSchema,
    rateLimit: { interval: 60_000, limit: 5 },
    rateLimitPrefix: "import",
  },
);
