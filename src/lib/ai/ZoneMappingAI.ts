/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type { FirewallVendor } from "../parsers/types";
import { ollamaGenerate } from "./OllamaClient";
import { logger } from "../logger";

export interface ZoneSuggestion {
  sourceZone: string;
  targetZone: string;
  confidence: number;
  reasoning: string;
}

export async function suggestZoneMappings(
  sourceZones: string[],
  sourceVendor: FirewallVendor,
  targetVendor: FirewallVendor,
): Promise<ZoneSuggestion[]> {
  if (sourceZones.length === 0) return [];

  const prompt = `You are a firewall migration expert. Map these zone names from ${sourceVendor} to ${targetVendor}.

Source zones: ${sourceZones.join(", ")}

Common zone naming conventions:
- Palo Alto: trust, untrust, dmz
- Cisco ASA: inside, outside, dmz (nameif)
- Fortinet: port1, port2, wan1, lan
- Juniper SRX: trust, untrust, dmz
- Check Point: uses topology-based zones

Provide mappings as JSON array: [{ "sourceZone": "...", "targetZone": "...", "confidence": 0.9, "reasoning": "..." }]`;

  try {
    const response = await ollamaGenerate(prompt);
    const parsed = JSON.parse(
      response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim(),
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logger.warn("AI zone mapping failed, using identity mapping", {
      error: error instanceof Error ? error.message : String(error),
    });
    return sourceZones.map((z) => ({
      sourceZone: z,
      targetZone: z,
      confidence: 0.5,
      reasoning: "Identity mapping (AI unavailable)",
    }));
  }
}
