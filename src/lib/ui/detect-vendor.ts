/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Guess the source vendor of a pasted or uploaded config (batch and import).
 */

import type { FirewallVendor } from "@/lib/vendors";

/** The vendor whose config format this looks like, or null when nothing matches. */
export function detectVendorStrict(content: string): FirewallVendor | null {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes("config firewall policy") || lower.includes("set srcintf"))
    return "FORTINET";
  if (
    lower.startsWith("<") ||
    lower.includes("rulebase security rules")
  )
    return "PALO_ALTO";
  if (lower.includes("access-list") && lower.includes("extended"))
    return "CISCO_ASA";
  if (
    lower.startsWith("{") &&
    (lower.includes('"objects-dictionary"') || lower.includes('"rulebase"'))
  )
    return "CHECKPOINT";
  if (
    lower.includes("security policies from-zone") ||
    lower.includes("security-zone")
  )
    return "JUNIPER_SRX";
  return null;
}

/** Batch import needs a vendor for every file: falls back to PAN-OS. */
export function detectVendor(content: string): FirewallVendor {
  return detectVendorStrict(content) ?? "PALO_ALTO";
}
