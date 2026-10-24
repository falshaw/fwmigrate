/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Shared mapping utility for converting Prisma NormalizedRule records
 * to the typed NormalizedRule interface used by parsers/generators/AI.
 */

import type { NormalizedRule } from "@/lib/parsers/types";

/**
 * Prisma NormalizedRule record shape (subset of fields used in mapping).
 * Kept minimal so callers don't need to import the full Prisma type.
 */
export interface PrismaNormalizedRuleRecord {
  name: string;
  position: number;
  enabled: boolean;
  action: string;
  sources: unknown;
  destinations: unknown;
  services: unknown;
  sourceZone: string | null;
  destinationZone: string | null;
  description: string | null;
  logging: boolean;
  rawVendorData?: unknown;
}

/**
 * Convert a Prisma NormalizedRule row to the typed NormalizedRule interface.
 *
 * Prisma stores sources, destinations, and services as Json columns that
 * need explicit casting to string[]. Optional fields (sourceZone,
 * destinationZone, description) use null in Prisma but undefined in the
 * domain type.
 */
export function toNormalizedRule(
  r: PrismaNormalizedRuleRecord,
): NormalizedRule {
  return {
    name: r.name,
    position: r.position,
    enabled: r.enabled,
    action: r.action as NormalizedRule["action"],
    sources: r.sources as string[],
    destinations: r.destinations as string[],
    services: r.services as string[],
    sourceZone: r.sourceZone ?? undefined,
    destinationZone: r.destinationZone ?? undefined,
    description: r.description ?? undefined,
    logging: r.logging,
    rawVendorData: r.rawVendorData as Record<string, unknown> | undefined,
  };
}

/**
 * Convert an array of Prisma NormalizedRule rows to typed NormalizedRule[].
 */
export function toNormalizedRules(
  rows: PrismaNormalizedRuleRecord[],
): NormalizedRule[] {
  return rows.map(toNormalizedRule);
}
