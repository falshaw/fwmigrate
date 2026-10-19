/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { explainTranslation } from "@/lib/ai/TranslationAI";
import { toNormalizedRule } from "@/lib/mappers/ruleMapper";
import type { FirewallVendor, NormalizedRule } from "@/lib/parsers/types";

const explainSchema = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
});

type ExplainInput = z.infer<typeof explainSchema>;

/**
 * POST /api/v1/ai/explain
 * Get an AI-powered explanation for a specific rule translation.
 * Requires the rule to already have a translated rule record.
 */
export const POST = apiHandler<ExplainInput>(
  async ({ body, organizationId }) => {
    // Find the normalized rule and its translation
    const rule = await prisma.normalizedRule.findUnique({
      where: { id: body.ruleId },
      include: {
        translatedRule: true,
        project: {
          select: {
            organizationId: true,
            sourceVendor: true,
            targetVendor: true,
          },
        },
      },
    });

    if (!rule) return notFound("Rule not found");
    if (rule.project.organizationId !== organizationId)
      return notFound("Rule not found");

    if (!rule.translatedRule) {
      return badRequest(
        "Rule has not been translated yet. Translate the project first.",
      );
    }

    // Build normalized rule type for the AI function
    const normalizedRule: NormalizedRule = toNormalizedRule(rule);

    const explanation = await explainTranslation(
      normalizedRule,
      rule.translatedRule.targetConfig,
      rule.project.sourceVendor as FirewallVendor,
      rule.project.targetVendor as FirewallVendor,
    );

    logger.info("AI explanation generated", {
      ruleId: body.ruleId,
      confidence: explanation.confidence,
    });

    return NextResponse.json({
      ruleId: body.ruleId,
      explanation: explanation.explanation,
      warnings: explanation.warnings,
      confidence: explanation.confidence,
    });
  },
  {
    schema: explainSchema,
    rateLimit: { interval: 60_000, limit: 20 },
    rateLimitPrefix: "ai-explain",
  },
);
