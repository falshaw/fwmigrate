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
import { getGenerator } from "@/lib/generators/GeneratorFactory";
import { explainTranslation } from "@/lib/ai/TranslationAI";
import { Prisma } from "@/generated/prisma";
import { toNormalizedRules } from "@/lib/mappers/ruleMapper";
import type {
  FirewallVendor,
  NormalizedRule,
  NormalizedObject,
} from "@/lib/parsers/types";
import type { ZoneMapping } from "@/lib/generators/GeneratorInterface";

/**
 * POST /api/v1/projects/[id]/translate
 * Translate all normalized rules to the target vendor format.
 * Uses the appropriate generator for config output and AI for explanations.
 * Creates TranslatedRule records for each normalized rule.
 */
export const POST = apiHandler(
  async ({ params, organizationId }) => {
    const project = await prisma.migrationProject.findUnique({
      where: { id: params.id },
      include: {
        normalizedRules: { orderBy: { position: "asc" } },
        normalizedObjects: true,
        zoneMappings: true,
      },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    if (project.normalizedRules.length === 0) {
      return badRequest(
        "No parsed rules to translate. Parse a configuration first.",
      );
    }

    await prisma.migrationProject.update({
      where: { id: params.id },
      data: { status: "TRANSLATING" },
    });

    logger.translation.run("start", {
      projectId: params.id,
      targetVendor: project.targetVendor,
      ruleCount: project.normalizedRules.length,
    });

    const sourceVendor = project.sourceVendor as FirewallVendor;
    const targetVendor = project.targetVendor as FirewallVendor;
    const generator = getGenerator(targetVendor);

    // Build zone mappings from DB records
    const zoneMappings: ZoneMapping[] = project.zoneMappings.map((zm) => ({
      sourceZone: zm.sourceZone,
      targetZone: zm.targetZone,
    }));

    // Convert Prisma records to parser types
    const rules: NormalizedRule[] = toNormalizedRules(project.normalizedRules);

    const objects: NormalizedObject[] = project.normalizedObjects.map((o) => ({
      objectType: o.objectType as NormalizedObject["objectType"],
      name: o.name,
      members: o.members as string[],
      rawVendorData: o.rawVendorData as Record<string, unknown> | undefined,
    }));

    // Generate full config using the generator
    const generatorResult = await generator.generate(
      rules,
      objects,
      zoneMappings,
    );

    // Delete old translated rules
    await prisma.translatedRule.deleteMany({ where: { projectId: params.id } });

    // For each rule, generate individual config and AI explanation
    let totalConfidence = 0;
    const translatedData: Array<Prisma.TranslatedRuleUncheckedCreateInput> = [];

    // Pre-compute per-rule configs (CPU-only, no I/O)
    const ruleWorkItems = project.normalizedRules
      .map((normalizedRule) => {
        const rule = rules.find((r) => r.position === normalizedRule.position);
        if (!rule) return null;

        const ruleConfig = generatorResult.ruleConfigs.find(
          (rc) => rc.position === rule.position,
        );
        const targetConfig =
          ruleConfig?.config ?? generator.generateRule(rule, zoneMappings);

        return { normalizedRule, rule, targetConfig };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // Process Ollama AI explanations in concurrent batches of 5
    // Ollama is single-threaded so unlimited parallelism would just queue;
    // batches of 5 balance throughput with resource usage.
    const OLLAMA_BATCH_SIZE = 5;

    for (let i = 0; i < ruleWorkItems.length; i += OLLAMA_BATCH_SIZE) {
      const batch = ruleWorkItems.slice(i, i + OLLAMA_BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async ({ normalizedRule, rule, targetConfig }) => {
          const aiResult = await explainTranslation(
            rule,
            targetConfig,
            sourceVendor,
            targetVendor,
          );

          return {
            projectId: params.id,
            normalizedRuleId: normalizedRule.id,
            targetConfig,
            targetVendor: project.targetVendor,
            explanation: aiResult.explanation,
            warnings: aiResult.warnings?.length
              ? aiResult.warnings
              : Prisma.JsonNull,
            confidence: aiResult.confidence,
          } satisfies Prisma.TranslatedRuleUncheckedCreateInput;
        }),
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          totalConfidence += result.value.confidence;
          translatedData.push(result.value);
        } else {
          logger.warn("Rule translation failed, skipping rule in batch", {
            projectId: params.id,
            batchIndex: i,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      }
    }

    // Batch insert all translated rules in a single DB query
    if (translatedData.length > 0) {
      await prisma.translatedRule.createMany({ data: translatedData });
    }

    const translatedCount = translatedData.length;
    const averageConfidence =
      translatedCount > 0 ? totalConfidence / translatedCount : 0;

    // Update project status
    await prisma.migrationProject.update({
      where: { id: params.id },
      data: { status: "TRANSLATED" },
    });

    logger.translation.run("success", {
      projectId: params.id,
      translatedCount,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
    });

    return NextResponse.json({
      translatedCount,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
    });
  },
  { rateLimit: { interval: 60_000, limit: 5 }, rateLimitPrefix: "translate" },
);
