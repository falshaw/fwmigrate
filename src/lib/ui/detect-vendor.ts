/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Guess the source vendor of a pasted or uploaded config (batch import).
 */

import type { FirewallVendor } from "@/lib/vendors";

export function detectVendor(content: string): FirewallVendor {
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
  return "PALO_ALTO";
}
