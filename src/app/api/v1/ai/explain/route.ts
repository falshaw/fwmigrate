/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { explainWithLlm } from "@/lib/ai/TranslationAI";
import { isLlmEnabled, llmModel, llmProvider } from "@/lib/ai/OllamaClient";
import { toNormalizedRule } from "@/lib/mappers/ruleMapper";
import type { FirewallVendor } from "@/lib/parsers/types";

const explainSchema = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
});

type ExplainInput = z.infer<typeof explainSchema>;

/**
 * POST /api/v1/ai/explain
 * LLM explanation of one translated rule (the review page's "Explain with AI").
 * Stored like the background job's explanations: apart from the deterministic
 * note, labelled with its model, never changing the config or the confidence.
 */
export const POST = apiHandler<ExplainInput>(
  async ({ body, organizationId }) => {
    if (!isLlmEnabled()) {
      return NextResponse.json({ error: "No LLM configured (LLM_PROVIDER=none)" }, { status: 503 });
    }

    const rule = await prisma.normalizedRule.findUnique({
      where: { id: body.ruleId },
      include: {
        translatedRule: true,
        project: { select: { organizationId: true, sourceVendor: true, targetVendor: true } },
      },
    });
    if (!rule || rule.project.organizationId !== organizationId) return notFound("Rule not found");
    if (!rule.translatedRule) return badRequest("Rule has not been translated yet. Translate the project first.");

    // Earlier AI notes are replaced; the translator's own flags stay
    const flags = ((rule.translatedRule.warnings as string[] | null) ?? []).filter((w) => !w.startsWith("AI:"));

    let ai;
    try {
      ai = await explainWithLlm(
        toNormalizedRule(rule),
        rule.translatedRule.targetConfig,
        rule.project.sourceVendor as FirewallVendor,
        rule.project.targetVendor as FirewallVendor,
        flags,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("AI explanation failed", { ruleId: body.ruleId, error: message });
      return NextResponse.json({ error: `The LLM gave no usable answer: ${message}` }, { status: 502 });
    }

    const aiModel = `${llmProvider()} · ${llmModel()}`;
    const warnings = [...flags, ...ai.warnings.map((w) => `AI: ${w}`)];
    await prisma.translatedRule.update({
      where: { id: rule.translatedRule.id },
      data: {
        aiExplanation: ai.explanation,
        aiModel,
        aiExplainedAt: new Date(),
        warnings: warnings.length ? warnings : Prisma.JsonNull,
      },
    });

    logger.info("AI explanation generated", { ruleId: body.ruleId });
    return NextResponse.json({ aiExplanation: ai.explanation, aiModel, warnings });
  },
  {
    schema: explainSchema,
    rateLimit: { interval: 60_000, limit: 20 },
    rateLimitPrefix: "ai-explain",
  },
);
