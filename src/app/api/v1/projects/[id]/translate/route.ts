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
import { getGenerator } from "@/lib/generators/GeneratorFactory";
import { Prisma } from "@/generated/prisma";
import { toNormalizedRules } from "@/lib/mappers/ruleMapper";
import { isLlmEnabled, llmProvider } from "@/lib/ai/OllamaClient";
import {
  cancelExplainJob,
  explainLimits,
  getExplainJob,
  startExplainJob,
  type ExplainItem,
} from "@/lib/ai/explainJobs";
import type { FirewallVendor, NormalizedObject } from "@/lib/parsers/types";
import type { ZoneMapping } from "@/lib/generators/GeneratorInterface";
import { statusAfterTranslate } from "@/lib/projectStatus";

const translateSchema = z
  .object({
    /** Queue LLM explanations after the translation (default: when an LLM is configured) */
    explain: z.boolean().optional(),
  })
  .optional();

type TranslateInput = z.infer<typeof translateSchema>;

async function loadProject(id: string, organizationId: string) {
  const project = await prisma.migrationProject.findUnique({
    where: { id },
    include: {
      normalizedRules: { orderBy: { position: "asc" } },
      normalizedObjects: true,
      zoneMappings: true,
      translatedRules: {
        select: {
          id: true,
          normalizedRuleId: true,
          targetConfig: true,
          reviewStatus: true,
          aiExplanation: true,
        },
      },
    },
  });
  if (!project || project.organizationId !== organizationId) return null;
  return project;
}

/**
 * POST /api/v1/projects/[id]/translate
 * Deterministic translation of every normalised rule with the target
 * generator. Returns as soon as the rules are stored. When an LLM is
 * configured (and `explain` is not false) per-rule explanations are queued
 * as a bounded background job; poll GET for its progress.
 */
export const POST = apiHandler(
  async ({ params, organizationId, req }) => {
    // Body is optional (the UI posts none); validate it when present
    const rawBody = await req.text();
    let body: TranslateInput;
    try {
      body = translateSchema.parse(rawBody.trim() ? JSON.parse(rawBody) : undefined);
    } catch {
      return badRequest('Body must be empty or {"explain": boolean}');
    }

    const project = await loadProject(params.id, organizationId);
    if (!project) return notFound("Project not found");

    if (project.normalizedRules.length === 0) {
      return badRequest("No parsed rules to translate. Parse a configuration first.");
    }

    cancelExplainJob(params.id);

    const started = Date.now();
    const sourceVendor = project.sourceVendor as FirewallVendor;
    const targetVendor = project.targetVendor as FirewallVendor;
    const generator = getGenerator(targetVendor);

    const zoneMappings: ZoneMapping[] = project.zoneMappings.map((zm) => ({
      sourceZone: zm.sourceZone,
      targetZone: zm.targetZone,
    }));
    const rules = toNormalizedRules(project.normalizedRules);
    const objects: NormalizedObject[] = project.normalizedObjects.map((o) => ({
      objectType: o.objectType as NormalizedObject["objectType"],
      name: o.name,
      members: o.members as string[],
      rawVendorData: o.rawVendorData as Record<string, unknown> | undefined,
    }));

    const result = await generator.generate(rules, objects, zoneMappings);
    const byPosition = new Map(result.ruleConfigs.map((rc) => [rc.position, rc]));

    // Keep a rule's review (and AI explanation) when its generated config is
    // unchanged; only rules whose output changed go back to PENDING.
    const previous = new Map(project.translatedRules.map((t) => [t.normalizedRuleId, t]));
    const next = project.normalizedRules.map((nr) => ({
      nr,
      rc: byPosition.get(nr.position)!,
    }));
    const outcome = statusAfterTranslate(
      project.status,
      project.translatedRules,
      next.map(({ nr, rc }) => ({ normalizedRuleId: nr.id, targetConfig: rc.config })),
    );

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const create: Prisma.TranslatedRuleCreateManyInput[] = [];
    const keepIds = new Set<string>();
    for (const { nr, rc } of next) {
      const warnings = rc.warnings.length ? rc.warnings : Prisma.JsonNull;
      const prev = previous.get(nr.id);
      if (prev && prev.targetConfig === rc.config) {
        keepIds.add(prev.id);
        writes.push(
          prisma.translatedRule.update({
            where: { id: prev.id },
            data: {
              explanation: rc.explanation,
              confidence: rc.confidence,
              // AI warnings of a kept explanation stay with it
              ...(prev.aiExplanation ? {} : { warnings }),
            },
          }),
        );
      } else if (prev) {
        keepIds.add(prev.id);
        writes.push(
          prisma.translatedRule.update({
            where: { id: prev.id },
            data: {
              targetConfig: rc.config,
              targetVendor: project.targetVendor,
              explanation: rc.explanation,
              warnings,
              confidence: rc.confidence,
              aiExplanation: null,
              aiModel: null,
              aiExplainedAt: null,
              reviewStatus: "PENDING",
              reviewerNote: null,
              manualOverride: null,
              reviewedAt: null,
              reviewedById: null,
            },
          }),
        );
      } else {
        create.push({
          projectId: params.id,
          normalizedRuleId: nr.id,
          targetConfig: rc.config,
          targetVendor: project.targetVendor,
          explanation: rc.explanation,
          warnings,
          confidence: rc.confidence,
        });
      }
    }

    await prisma.$transaction([
      prisma.translatedRule.deleteMany({
        where: { projectId: params.id, id: { notIn: [...keepIds] } },
      }),
      ...writes,
      prisma.translatedRule.createMany({ data: create }),
      ...(outcome.status !== project.status
        ? [
            prisma.migrationProject.update({
              where: { id: params.id },
              data: { status: outcome.status },
            }),
          ]
        : []),
    ]);

    const translatedCount = next.length;
    const averageConfidence =
      Math.round((result.ruleConfigs.reduce((s, r) => s + r.confidence, 0) / translatedCount) * 100) / 100;
    const reviewFlags = result.ruleConfigs.filter((r) => r.warnings.some((w) => w.startsWith("REVIEW:"))).length;

    // Optional, bounded, after the response
    let explain: Record<string, unknown> = { status: "disabled", provider: "none" };
    const wantExplain = body?.explain ?? true;
    if (isLlmEnabled() && wantExplain && explainLimits().maxRules > 0) {
      const stored = await prisma.translatedRule.findMany({
        where: { projectId: params.id },
        select: { id: true, aiExplanation: true, normalizedRule: { select: { position: true } } },
      });
      // Rules whose output did not change keep their AI explanation; only the rest is queued
      const idByPosition = new Map(
        stored.filter((s) => !s.aiExplanation).map((s) => [s.normalizedRule.position, s.id]),
      );
      const items: ExplainItem[] = rules.filter((rule) => idByPosition.has(rule.position)).map((rule) => {
        const rc = byPosition.get(rule.position)!;
        return {
          translatedRuleId: idByPosition.get(rule.position)!,
          rule,
          targetConfig: rc.config,
          reviewFlags: rc.warnings,
        };
      });
      explain = { ...startExplainJob(params.id, items, sourceVendor, targetVendor), provider: llmProvider() };
    } else if (isLlmEnabled()) {
      explain = { status: "not-requested", provider: llmProvider() };
    }

    logger.translation.run("success", {
      projectId: params.id,
      translatedCount,
      averageConfidence,
      durationMs: Date.now() - started,
    });

    return NextResponse.json({
      translatedCount,
      averageConfidence,
      rulesWithReviewFlags: reviewFlags,
      changedRules: outcome.changed,
      unchangedRules: outcome.kept,
      status: outcome.status,
      durationMs: Date.now() - started,
      explain,
    });
  },
  {
    rateLimit: { interval: 60_000, limit: 10 },
    rateLimitPrefix: "translate",
  },
);

/**
 * GET /api/v1/projects/[id]/translate
 * Progress of the optional LLM explanation job.
 */
export const GET = apiHandler(async ({ params, organizationId }) => {
  const project = await prisma.migrationProject.findUnique({
    where: { id: params.id },
    select: { organizationId: true, status: true },
  });
  if (!project || project.organizationId !== organizationId) return notFound("Project not found");
  return NextResponse.json({
    projectStatus: project.status,
    llm: { enabled: isLlmEnabled(), provider: llmProvider() },
    explain: getExplainJob(params.id) ?? { status: isLlmEnabled() ? "idle" : "disabled" },
  });
});
