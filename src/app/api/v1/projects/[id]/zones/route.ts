/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { suggestZoneMappings } from "@/lib/ai/ZoneMappingAI";
import { zoneMappingSchema } from "@/lib/validators/project";
import type { ZoneMappingInput } from "@/lib/validators/project";
import type { FirewallVendor } from "@/lib/parsers/types";

/**
 * GET /api/v1/projects/[id]/zones
 * The zone mappings of a project plus every zone its parsed rules use.
 */
export const GET = apiHandler(async ({ params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.id },
    select: {
      organizationId: true,
      normalizedRules: { select: { sourceZone: true, destinationZone: true } },
    },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  const zoneMappings = await prisma.zoneMapping.findMany({
    where: { projectId: params.id },
    orderBy: { sourceZone: "asc" },
  });

  const zones = new Set<string>();
  for (const r of project.normalizedRules) {
    for (const z of [r.sourceZone, r.destinationZone]) {
      if (z && z.toLowerCase() !== "any") zones.add(z);
    }
  }

  return NextResponse.json({
    zoneMappings,
    sourceZones: [...zones].sort((a, b) => a.localeCompare(b)),
  });
});

/**
 * POST /api/v1/projects/[id]/zones
 * Create or replace zone mappings for a project.
 * If no mappings are provided in the body, uses AI to suggest mappings
 * based on the source zones found in the project's normalized rules.
 */
export const POST = apiHandler<ZoneMappingInput>(
  async ({ body, params, organizationId }) => {
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      include: {
        normalizedRules: {
          select: { sourceZone: true, destinationZone: true },
        },
      },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    // Delete existing mappings
    await prisma.zoneMapping.deleteMany({ where: { projectId: params.id } });

    let mappingsToCreate: Array<{
      projectId: string;
      sourceZone: string;
      targetZone: string;
      confidence: number;
      aiReasoning: string | null;
      isConfirmed: boolean;
    }>;

    if (body.mappings.length === 0) {
      // No mappings provided — use AI suggestions
      // Extract unique source zones from project rules
      const sourceZones = new Set<string>();
      for (const rule of project.normalizedRules) {
        if (rule.sourceZone) sourceZones.add(rule.sourceZone);
        if (rule.destinationZone) sourceZones.add(rule.destinationZone);
      }

      const suggestions = await suggestZoneMappings(
        Array.from(sourceZones),
        project.sourceVendor as FirewallVendor,
        project.targetVendor as FirewallVendor,
      );

      mappingsToCreate = suggestions.map((s) => ({
        projectId: params.id,
        sourceZone: s.sourceZone,
        targetZone: s.targetZone,
        confidence: s.confidence,
        aiReasoning: s.reasoning,
        isConfirmed: false,
      }));

      logger.info("AI zone mapping generated", {
        projectId: params.id,
        mappingCount: mappingsToCreate.length,
      });
    } else {
      // Use user-provided mappings
      mappingsToCreate = body.mappings.map((m) => ({
        projectId: params.id,
        sourceZone: m.sourceZone,
        targetZone: m.targetZone,
        confidence: 1.0,
        aiReasoning: null,
        isConfirmed: m.isConfirmed,
      }));
    }

    // Create all mappings
    if (mappingsToCreate.length > 0) {
      await prisma.zoneMapping.createMany({ data: mappingsToCreate });
    }

    // Fetch the created mappings to return with IDs
    const zoneMappings = await prisma.zoneMapping.findMany({
      where: { projectId: params.id },
      orderBy: { sourceZone: "asc" },
    });

    return NextResponse.json({ zoneMappings }, { status: 201 });
  },
  { schema: zoneMappingSchema },
);
