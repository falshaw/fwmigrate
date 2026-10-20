/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Optional LLM explanation of an already generated (deterministic) rule
 * translation. The LLM never changes the config or the confidence score.
 */

import type { NormalizedRule, FirewallVendor } from "../parsers/types";
import { ollamaGenerate } from "./OllamaClient";
import { logger } from "../logger";

export interface TranslationExplanation {
  rulePosition: number;
  explanation: string;
  warnings: string[];
  /** "llm" when the model answered, "fallback" when it did not */
  source: "llm" | "fallback";
}

function buildPrompt(
  rule: NormalizedRule,
  targetConfig: string,
  sourceVendor: FirewallVendor,
  targetVendor: FirewallVendor,
  reviewFlags: string[],
): string {
  const apps = (rule.rawVendorData?.application as string[] | undefined)?.filter(
    (a) => a !== "any",
  );
  return `You are a senior firewall engineer reviewing one migrated rule.

Source vendor: ${sourceVendor}
Target vendor: ${targetVendor}

Source rule:
  Name: ${rule.name}
  Action: ${rule.action}
  Sources: ${rule.sources.join(", ")}
  Destinations: ${rule.destinations.join(", ")}
  Services: ${rule.services.join(", ")}${apps?.length ? `\n  Applications (App-ID): ${apps.join(", ")}` : ""}
  Source zone: ${rule.sourceZone || "any"}
  Destination zone: ${rule.destinationZone || "any"}
  Enabled: ${rule.enabled}

Generated target config (do not rewrite it):
${targetConfig}

Review flags already raised by the translator:
${reviewFlags.length ? reviewFlags.map((f) => `- ${f}`).join("\n") : "- none"}

In two or three plain sentences, explain what the rule allows or blocks and
any behavioural difference between the two platforms an engineer must check.
List extra warnings only if they are concrete and not already in the flags.
Do not invent objects, ports or vendor features.

Respond with JSON only: {"explanation": "...", "warnings": ["..."]}`;
}

/** Throws when the LLM is disabled, times out or returns garbage. */
export async function explainWithLlm(
  rule: NormalizedRule,
  targetConfig: string,
  sourceVendor: FirewallVendor,
  targetVendor: FirewallVendor,
  reviewFlags: string[] = [],
): Promise<TranslationExplanation> {
  const response = await ollamaGenerate(
    buildPrompt(rule, targetConfig, sourceVendor, targetVendor, reviewFlags),
    { json: true, temperature: 0.2 },
  );
  const parsed = JSON.parse(
    response
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim(),
  ) as { explanation?: unknown; warnings?: unknown };
  if (typeof parsed.explanation !== "string" || !parsed.explanation.trim())
    throw new Error("LLM returned no explanation");
  return {
    rulePosition: rule.position,
    explanation: parsed.explanation.trim(),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w): w is string => typeof w === "string" && !!w.trim()).slice(0, 5)
      : [],
    source: "llm",
  };
}

/** Never throws: falls back to a plain description when the LLM is unavailable. */
export async function explainTranslation(
  sourceRule: NormalizedRule,
  targetConfig: string,
  sourceVendor: FirewallVendor,
  targetVendor: FirewallVendor,
  reviewFlags: string[] = [],
): Promise<TranslationExplanation> {
  try {
    return await explainWithLlm(sourceRule, targetConfig, sourceVendor, targetVendor, reviewFlags);
  } catch (error) {
    logger.warn("AI explanation unavailable, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      rulePosition: sourceRule.position,
      explanation: `Rule "${sourceRule.name}" translated from ${sourceVendor} to ${targetVendor}. Action: ${sourceRule.action}, sources: ${sourceRule.sources.join(", ")}, destinations: ${sourceRule.destinations.join(", ")}, services: ${sourceRule.services.join(", ")}.`,
      warnings: [],
      source: "fallback",
    };
  }
}
