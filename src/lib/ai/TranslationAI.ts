/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type { NormalizedRule, FirewallVendor } from "../parsers/types";
import { ollamaGenerate } from "./OllamaClient";
import { logger } from "../logger";

export interface TranslationExplanation {
  rulePosition: number;
  explanation: string;
  warnings: string[];
  confidence: number;
}

export async function explainTranslation(
  sourceRule: NormalizedRule,
  targetConfig: string,
  sourceVendor: FirewallVendor,
  targetVendor: FirewallVendor,
): Promise<TranslationExplanation> {
  const prompt = `You are a firewall migration expert. Explain the following rule translation.

Source vendor: ${sourceVendor}
Target vendor: ${targetVendor}

Source rule:
  Name: ${sourceRule.name}
  Action: ${sourceRule.action}
  Sources: ${sourceRule.sources.join(", ")}
  Destinations: ${sourceRule.destinations.join(", ")}
  Services: ${sourceRule.services.join(", ")}
  Source Zone: ${sourceRule.sourceZone || "any"}
  Destination Zone: ${sourceRule.destinationZone || "any"}

Generated target config:
${targetConfig}

Provide:
1. A clear explanation of what this rule does and how it was translated
2. Any warnings about potential differences between vendors
3. A confidence score (0-1) for the translation accuracy

Respond in JSON format: { "explanation": "...", "warnings": ["..."], "confidence": 0.95 }`;

  try {
    const response = await ollamaGenerate(prompt);
    const parsed = JSON.parse(
      response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim(),
    );

    return {
      rulePosition: sourceRule.position,
      explanation: parsed.explanation || "Translation completed",
      warnings: parsed.warnings || [],
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
    };
  } catch (error) {
    logger.warn("AI explanation failed, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      rulePosition: sourceRule.position,
      explanation: `Rule "${sourceRule.name}" translated from ${sourceVendor} to ${targetVendor} format. Action: ${sourceRule.action}, Sources: ${sourceRule.sources.join(", ")}, Destinations: ${sourceRule.destinations.join(", ")}, Services: ${sourceRule.services.join(", ")}`,
      warnings: [],
      confidence: 0.7,
    };
  }
}
