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
import { importConfigSchema } from "@/lib/validators/project";
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
  async ({ body, params, organizationId }) => {
    // Defense-in-depth: check raw config size before any DB operations
    const fileSize = Buffer.byteLength(body.rawConfig, "utf8");
    if (fileSize > MAX_IMPORT_SIZE) {
      return badRequest(
        `Config size ${(fileSize / (1024 * 1024)).toFixed(1)}MB exceeds maximum of ${MAX_IMPORT_SIZE / (1024 * 1024)}MB`,
      );
    }

    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, sourceConfig: true },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    if (project.sourceConfig) {
      return badRequest(
        "Project already has an imported config. Delete and re-import to replace.",
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
