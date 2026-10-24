/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Fixtures, reference checks (from src/lib/validation/references.ts) and
 * the keywords one vendor's output must never contain.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { referenceProblems } from "../../src/lib/validation/references";
import type { FirewallVendor } from "../../src/lib/vendors";

export const FIXTURES: Record<FirewallVendor, string> = {
  PALO_ALTO: "paloalto-config.xml",
  CISCO_ASA: "cisco-asa-show-run.txt",
  CHECKPOINT: "checkpoint-export.json",
  FORTINET: "fortinet-config.txt",
  JUNIPER_SRX: "juniper-set-config.txt",
};

export function fixture(v: FirewallVendor): string {
  return readFileSync(join(__dirname, "../fixtures", FIXTURES[v]), "utf-8");
}

/** Unresolved references in generated output (shared with the config validator). */
export const REFERENCE_CHECKS = Object.fromEntries(
  (["FORTINET", "JUNIPER_SRX", "CISCO_ASA", "CHECKPOINT", "PALO_ALTO"] as FirewallVendor[]).map((v) => [
    v,
    (c: string) => referenceProblems(c, v).map((p) => p.ref),
  ]),
) as Record<FirewallVendor, (c: string) => string[]>;

/** Keywords of one vendor that must never appear in another vendor's output */
export const FOREIGN_TOKENS: Record<FirewallVendor, RegExp[]> = {
  FORTINET: [/application-default/, /service-https?\b/, /junos-/, /set (srcaddr|dstaddr|service) .*"any"/],
  JUNIPER_SRX: [/application-default/, /service-https?\b/, /match \S+ (all|ALL)$/m, /"ALL"/],
  CISCO_ASA: [/application-default/, /service-https?\b/, /junos-/, /"ALL"/, /^access-list \S+ extended .* all( |$)/m],
  CHECKPOINT: [/application-default/, /service-https?\b/, /junos-/, /"ALL"/, /"any"/],
  PALO_ALTO: [/junos-/, /"ALL"/, /"all"/, /set srcaddr/],
};

export { FORTIOS_PREDEFINED_SERVICES } from "../../src/lib/validation/references";

export const fortiosReferenceProblems = (c: string) => REFERENCE_CHECKS.FORTINET(c);
