/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * POST /api/v1/integrate/change-manager — Push migrated rules to Change Manager
 * FM-07: Change Manager Integration
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import {
  getChangeManagerConfig,
  pushRulesToChangeManager,
  type ChangeManagerRulePayload,
} from "@/lib/change-manager-integration";
import { vendorLabel } from "@/lib/vendors";
import { z } from "zod";

const integrationSchema = z.object({
  projectId: z.string().min(1),
  changeManagerDeviceId: z.string().min(1).optional(),
  description: z.string().max(2000).optional(),
});

type IntegrationInput = z.infer<typeof integrationSchema>;

export const POST = apiHandler<IntegrationInput>(
  async ({ body, organizationId }) => {
    const changeManagerApiUrl = getChangeManagerConfig().apiUrl;
    if (!changeManagerApiUrl) {
      return NextResponse.json(
        { error: "Change Manager is not configured (CHANGE_MANAGER_API_URL is not set)" },
        { status: 503 },
      );
    }

    const project = await prisma.migrationProject.findUnique({
      where: { id: body.projectId },
      include: {
        translatedRules: {
          where: {
            reviewStatus: { in: ["APPROVED", "MODIFIED"] },
          },
          include: {
            normalizedRule: true,
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
        "No approved or modified rules to push. Review and approve rules first.",
      );
    }

    // Build Change Manager-compatible rule payloads
    const rules: ChangeManagerRulePayload[] = project.translatedRules.map((tr) => {
      const nr = tr.normalizedRule;
      const sources = Array.isArray(nr.sources) ? (nr.sources as string[]) : [];
      const destinations = Array.isArray(nr.destinations)
        ? (nr.destinations as string[])
        : [];
      const services = Array.isArray(nr.services)
        ? (nr.services as string[])
        : [];

      return {
        name: nr.name,
        action: nr.action,
        sources,
        destinations,
        services,
        sourceZone: nr.sourceZone || undefined,
        destinationZone: nr.destinationZone || undefined,
        description: body.description
          ? `${body.description} | Migrated from ${vendorLabel(project.sourceVendor)}`
          : `Migrated from ${vendorLabel(project.sourceVendor)} with FW Migrate`,
        enabled: nr.enabled,
        status: "pending_review",
        migrationSource: {
          projectId: project.id,
          projectName: project.name,
          sourceVendor: project.sourceVendor,
          targetVendor: project.targetVendor,
          translationConfidence: tr.confidence,
          originalRuleName: nr.name,
          translatedConfig:
            tr.reviewStatus === "MODIFIED" && tr.manualOverride
              ? tr.manualOverride
              : tr.targetConfig,
        },
      };
    });

    // The shared client sends CHANGE_MANAGER_API_KEY as a bearer token
    const result = await pushRulesToChangeManager(rules, project.id, project.name);
    return NextResponse.json(result);
  },
  { schema: integrationSchema },
);
