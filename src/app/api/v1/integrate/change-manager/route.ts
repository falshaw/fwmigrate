/**
 * FW Migrate - AI-Powered Firewall Migration Platform
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
import { logger } from "@/lib/logger";
import { getChangeManagerConfig } from "@/lib/change-manager-integration";
import { z } from "zod";

const integrationSchema = z.object({
  projectId: z.string().min(1),
  changeManagerDeviceId: z.string().min(1).optional(),
  description: z.string().max(2000).optional(),
});

type IntegrationInput = z.infer<typeof integrationSchema>;

interface ChangeManagerRule {
  name: string;
  action: string;
  sources: string[];
  destinations: string[];
  services: string[];
  sourceZone?: string;
  destinationZone?: string;
  description?: string;
  enabled: boolean;
  status: string;
  migrationSource: {
    projectId: string;
    projectName: string;
    sourceVendor: string;
    targetVendor: string;
    translationConfidence: number;
    originalRuleName: string;
    translatedConfig: string;
  };
}

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
    const rules: ChangeManagerRule[] = project.translatedRules.map((tr) => {
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
          ? `${body.description} | Migrated from ${project.sourceVendor}`
          : `Migrated from ${project.sourceVendor} via FW Migrate`,
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

    // Push rules to Change Manager API
    const pushResults: Array<{
      ruleName: string;
      status: "success" | "failed";
      changeManagerRuleId?: string;
      error?: string;
    }> = [];

    let successCount = 0;
    let failCount = 0;

    for (const rule of rules) {
      try {
        const response = await fetch(`${changeManagerApiUrl}/api/rules/import`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Source": "fwmigrate",
            "X-Migration-Project": project.id,
          },
          body: JSON.stringify(rule),
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json();
          pushResults.push({
            ruleName: rule.name,
            status: "success",
            changeManagerRuleId: data.id || data.ruleId,
          });
          successCount++;
        } else {
          const errorText = await response.text().catch(() => "Unknown error");
          pushResults.push({
            ruleName: rule.name,
            status: "failed",
            error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
          });
          failCount++;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        pushResults.push({
          ruleName: rule.name,
          status: "failed",
          error: errorMsg,
        });
        failCount++;
      }
    }

    logger.info("Change Manager integration completed", {
      projectId: project.id,
      totalRules: rules.length,
      success: successCount,
      failed: failCount,
    });

    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      totalRules: rules.length,
      success: successCount,
      failed: failCount,
      results: pushResults,
      changeManagerUrl: changeManagerApiUrl,
    });
  },
  { schema: integrationSchema },
);
