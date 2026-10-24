/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Background LLM explanations for translated rules.
 *
 * Translation itself is deterministic and returns immediately; explanations
 * are optional and run here after the response, bounded by a per-call
 * timeout (LLM_TIMEOUT_MS), a concurrency limit (LLM_CONCURRENCY) and a
 * per-run rule cap (LLM_EXPLAIN_MAX_RULES). State is in memory, which fits
 * the single-instance deployment in docker-compose.yml.
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { logger } from "@/lib/logger";
import type { FirewallVendor, NormalizedRule } from "@/lib/parsers/types";
import { explainWithLlm } from "./TranslationAI";
import { llmModel, llmProvider } from "./OllamaClient";

export interface ExplainItem {
  translatedRuleId: string;
  rule: NormalizedRule;
  targetConfig: string;
  reviewFlags: string[];
}

export interface ExplainJobState {
  status: "running" | "done" | "cancelled";
  total: number;
  done: number;
  failed: number;
  skipped: number;
  startedAt: string;
  finishedAt?: string;
  lastError?: string;
}

const jobs = new Map<string, ExplainJobState & { runId: number }>();
let runCounter = 0;

const intEnv = (name: string, def: number, min: number, max: number) =>
  Math.min(max, Math.max(min, parseInt(process.env[name] || "", 10) || def));

export function explainLimits() {
  return {
    maxRules: intEnv("LLM_EXPLAIN_MAX_RULES", 50, 0, 1000),
    concurrency: intEnv("LLM_CONCURRENCY", 1, 1, 8),
  };
}

export function getExplainJob(projectId: string): ExplainJobState | null {
  const j = jobs.get(projectId);
  if (!j) return null;
  const { runId: _runId, ...state } = j;
  return state;
}

/** Stops writing results of a previous run (e.g. the project was re-translated). */
export function cancelExplainJob(projectId: string): void {
  const j = jobs.get(projectId);
  if (j && j.status === "running") {
    j.status = "cancelled";
    j.finishedAt = new Date().toISOString();
  }
}

/** Starts the job and returns at once; the work continues after the HTTP response. */
export function startExplainJob(
  projectId: string,
  items: ExplainItem[],
  sourceVendor: FirewallVendor,
  targetVendor: FirewallVendor,
): ExplainJobState {
  cancelExplainJob(projectId);
  const { maxRules, concurrency } = explainLimits();
  const queue = items.slice(0, maxRules);
  const runId = ++runCounter;
  const state = {
    runId,
    status: "running" as const,
    total: queue.length,
    done: 0,
    failed: 0,
    skipped: items.length - queue.length,
    startedAt: new Date().toISOString(),
  };
  jobs.set(projectId, { ...state });
  const live = () => {
    const j = jobs.get(projectId);
    return j && j.runId === runId && j.status === "running" ? j : null;
  };

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      if (!live()) return;
      try {
        const ai = await explainWithLlm(
          item.rule,
          item.targetConfig,
          sourceVendor,
          targetVendor,
          item.reviewFlags,
        );
        if (!live()) return;
        const warnings = [...item.reviewFlags, ...ai.warnings.map((w) => `AI: ${w}`)];
        await prisma.translatedRule.update({
          where: { id: item.translatedRuleId },
          // The generator's deterministic note stays in `explanation`;
          // the LLM text is stored apart and labelled with its model in the UI.
          data: {
            aiExplanation: ai.explanation,
            aiModel: `${llmProvider()} · ${llmModel()}`,
            aiExplainedAt: new Date(),
            warnings: warnings.length ? warnings : Prisma.JsonNull,
          },
        });
        const j = live();
        if (j) j.done++;
      } catch (error) {
        const j = live();
        if (j) {
          j.failed++;
          j.lastError = error instanceof Error ? error.message : String(error);
        }
      }
    }
  };

  void Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker))
    .catch((error) =>
      logger.error("Explain job crashed", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .finally(() => {
      const j = live();
      if (j) {
        j.status = "done";
        j.finishedAt = new Date().toISOString();
        logger.info("Explain job finished", { projectId, done: j.done, failed: j.failed });
      }
    });

  const { runId: _r, ...out } = state;
  return out;
}
