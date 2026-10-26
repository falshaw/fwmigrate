/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Optional LLM explanation of an already generated (deterministic) rule
 * translation. The LLM never changes the config or the confidence score.
 */

import type { NormalizedRule, FirewallVendor } from "../parsers/types";
import { ollamaGenerate } from "./OllamaClient";
import { logger } from "../logger";
import { vendorLabel } from "../vendors";
import { configDisablesRule } from "../generators/base";

/**
 * Facts the model must not contradict. Without them small models claimed that
 * PAN-OS App-ID with application-default matches "regardless of port".
 */
function platformFacts(rule: NormalizedRule, sourceVendor: FirewallVendor): string[] {
  const facts: string[] = [];
  if (sourceVendor === "PALO_ALTO" && rule.services.includes("application-default")) {
    facts.push(
      'PAN-OS service "application-default" allows each listed App-ID only on that application\'s standard ports. ' +
        "A target rule on those same ports therefore matches the same ports. The real difference: the target no " +
        "longer checks that the traffic IS that application, so any traffic on those ports is allowed.",
    );
  }
  if (!rule.enabled) facts.push("The source rule is disabled: it matches no traffic.");
  if (rule.rawVendorData?.notApplied === true)
    facts.push(
      `On the source, access list ${String(rule.rawVendorData.aclName ?? "")} is not applied with access-group, ` +
        "so this rule matches no transit traffic there. Migrated as a live policy it would change what the firewall does.",
    );
  return facts;
}

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
  const facts = platformFacts(rule, sourceVendor);
  if (configDisablesRule(targetConfig))
    facts.push("The generated target rule is emitted disabled: it matches no traffic until an engineer enables it.");
  return `You are a senior firewall engineer reviewing one migrated rule.

Source vendor: ${vendorLabel(sourceVendor)}
Target vendor: ${vendorLabel(targetVendor)}

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

${facts.length ? `Facts (true, do not contradict them):\n${facts.map((f) => `- ${f}`).join("\n")}\n\n` : ""}In two or three plain sentences, explain what the rule allows or blocks and
any behavioural difference between the two platforms that matters for THIS rule.
List extra warnings only if they are concrete and not already in the flags.
Do not invent objects, ports or vendor features. Do not add generic remarks
about the platforms (proxy or flow mode, session timeouts, logging defaults,
"verify the object contents") that this rule's config does not show.
If there is no behavioural difference, say so.

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
      explanation: `Rule "${sourceRule.name}" translated from ${vendorLabel(sourceVendor)} to ${vendorLabel(targetVendor)}. Action: ${sourceRule.action}, sources: ${sourceRule.sources.join(", ")}, destinations: ${sourceRule.destinations.join(", ")}, services: ${sourceRule.services.join(", ")}.`,
      warnings: [],
      source: "fallback",
    };
  }
}
