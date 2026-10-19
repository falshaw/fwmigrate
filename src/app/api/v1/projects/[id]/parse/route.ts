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
import { getParser } from "@/lib/parsers/ParserFactory";
import type { FirewallVendor } from "@/lib/parsers/types";

/**
 * POST /api/v1/projects/[id]/parse
 * Parse the imported configuration using the vendor-specific parser.
 * Creates NormalizedRule, NormalizedObject, and NormalizedNATRule records.
 * Updates project counts, confidence, and status.
 */
export const POST = apiHandler(
  async ({ params, organizationId }) => {
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      include: { sourceConfig: true },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    if (!project.sourceConfig) {
      return badRequest(
        "No config imported yet. Import a configuration first.",
      );
    }

    await prisma.migrationProject.update({
      where: { id: params.id },
      data: { status: "PARSING" },
    });

    logger.parser.run(project.sourceVendor, "start", { projectId: params.id });

    const parser = getParser(project.sourceVendor as FirewallVendor);
    const result = await parser.parse(project.sourceConfig.rawConfig);

    // Delete any previous parsed data from a prior parse attempt
    await prisma.$transaction([
      prisma.normalizedRule.deleteMany({ where: { projectId: params.id } }),
      prisma.normalizedObject.deleteMany({ where: { projectId: params.id } }),
      prisma.normalizedNATRule.deleteMany({ where: { projectId: params.id } }),
    ]);

    // Create normalized rules
    if (result.rules.length > 0) {
      await prisma.normalizedRule.createMany({
        data: result.rules.map((rule) => ({
          projectId: params.id,
          position: rule.position,
          name: rule.name,
          enabled: rule.enabled,
          action: rule.action,
          sources: rule.sources,
          destinations: rule.destinations,
          services: rule.services,
          sourceZone: rule.sourceZone,
          destinationZone: rule.destinationZone,
          description: rule.description,
          logging: rule.logging,
          rawVendorData: (rule.rawVendorData as object) ?? undefined,
        })),
      });
    }

    // Create normalized objects
    if (result.objects.length > 0) {
      await prisma.normalizedObject.createMany({
        data: result.objects.map((obj) => ({
          projectId: params.id,
          objectType: obj.objectType,
          name: obj.name,
          members: obj.members as string[],
          rawVendorData: (obj.rawVendorData as object) ?? undefined,
        })),
      });
    }

    // Create normalized NAT rules
    if (result.natRules.length > 0) {
      await prisma.normalizedNATRule.createMany({
        data: result.natRules.map((nat) => ({
          projectId: params.id,
          position: nat.position,
          natType: nat.natType,
          originalSource: nat.originalSource as string[],
          translatedSource: nat.translatedSource as string[],
          originalDest: nat.originalDest as string[],
          translatedDest: nat.translatedDest as string[],
          service: (nat.service as string[]) ?? undefined,
          rawVendorData: (nat.rawVendorData as object) ?? undefined,
        })),
      });
    }

    // Update project counts and status
    await prisma.migrationProject.update({
      where: { id: params.id },
      data: {
        status: "PARSED",
        ruleCount: result.rules.length,
        objectCount: result.objects.length,
        natRuleCount: result.natRules.length,
        parseConfidence: result.confidence,
      },
    });

    // Update source config parse log
    await prisma.sourceConfig.update({
      where: { id: project.sourceConfig.id },
      data: { parseLog: result.parseLog as unknown as object[] },
    });

    logger.parser.run(project.sourceVendor, "success", {
      projectId: params.id,
      ruleCount: result.rules.length,
      objectCount: result.objects.length,
      natRuleCount: result.natRules.length,
      confidence: result.confidence,
    });

    return NextResponse.json({
      ruleCount: result.rules.length,
      objectCount: result.objects.length,
      natRuleCount: result.natRules.length,
      confidence: result.confidence,
      warnings: result.warnings,
    });
  },
  { rateLimit: { interval: 60_000, limit: 10 }, rateLimitPrefix: "parse" },
);
