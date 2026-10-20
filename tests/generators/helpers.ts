/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Reference checkers: every name a generated rule uses must be either a
 * predefined object of the target platform or defined in the same output.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { SERVICE_CATALOG } from "../../src/lib/generators/services";
import type { FirewallVendor } from "../../src/lib/vendors";

const names = (key: "fortinet" | "junos" | "checkpoint" | "panos") =>
  new Set(
    Object.values(SERVICE_CATALOG)
      .map((e) => e.names[key])
      .filter((n): n is string => !!n),
  );

export const FORTIOS_PREDEFINED_SERVICES = new Set([...names("fortinet"), "ALL"]);
export const JUNOS_PREDEFINED_APPS = new Set([...names("junos"), "junos-dns-udp", "junos-dns-tcp"]);
export const CHECKPOINT_PREDEFINED_SERVICES = new Set([...names("checkpoint"), "domain-udp", "domain-tcp"]);
export const PANOS_PREDEFINED_SERVICES = new Set(["service-http", "service-https"]);

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

const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

export function fortiosReferenceProblems(config: string): string[] {
  const problems: string[] = [];
  const section = (hdr: string) => {
    const i = config.indexOf(`config ${hdr}\n`);
    if (i < 0) return new Set<string>();
    const body = config.slice(i, config.indexOf("\nend", i));
    return new Set([...body.matchAll(/^\s+edit "([^"]+)"/gm)].map((m) => m[1]));
  };
  const addrs = new Set([...section("firewall address"), ...section("firewall addrgrp"), "all"]);
  const svcs = new Set([...section("firewall service custom"), ...FORTIOS_PREDEFINED_SERVICES]);
  for (const m of config.matchAll(/set (srcaddr|dstaddr) (.+)/g))
    for (const n of quoted(m[2])) if (!addrs.has(n)) problems.push(`address ${n}`);
  for (const m of config.matchAll(/set service (.+)/g))
    for (const n of quoted(m[1])) if (!svcs.has(n)) problems.push(`service ${n}`);
  for (const m of config.matchAll(/set member (.+)/g))
    for (const n of quoted(m[1])) if (!addrs.has(n)) problems.push(`group member ${n}`);
  return problems;
}

export function junosReferenceProblems(config: string): string[] {
  const problems: string[] = [];
  const addrs = new Set(["any"]);
  for (const m of config.matchAll(/address-book global address (\S+) /g)) addrs.add(m[1]);
  for (const m of config.matchAll(/address-book global address-set (\S+) /g)) addrs.add(m[1]);
  const apps = new Set(["any", ...JUNOS_PREDEFINED_APPS]);
  for (const m of config.matchAll(/set applications application (\S+) /g)) apps.add(m[1]);
  for (const m of config.matchAll(/match (source|destination)-address (\S+)/g))
    if (!addrs.has(m[2])) problems.push(`address ${m[2]}`);
  for (const m of config.matchAll(/match application (\S+)/g))
    if (!apps.has(m[1])) problems.push(`application ${m[1]}`);
  return problems;
}

export function asaReferenceProblems(config: string): string[] {
  const problems: string[] = [];
  const objects = new Set<string>();
  const groups = new Set<string>();
  for (const m of config.matchAll(/^object (?:network|service) (\S+)/gm)) objects.add(m[1]);
  for (const m of config.matchAll(/^object-group (?:network|service) (\S+)/gm)) groups.add(m[1]);
  const acls = new Set<string>();
  for (const line of config.split("\n")) {
    const ace = line.match(/^access-list (\S+) extended /);
    if (!ace) continue;
    acls.add(ace[1]);
    for (const m of line.matchAll(/\bobject (\S+)/g)) if (!objects.has(m[1])) problems.push(`object ${m[1]}`);
    for (const m of line.matchAll(/\bobject-group (\S+)/g)) if (!groups.has(m[1])) problems.push(`object-group ${m[1]}`);
  }
  for (const m of config.matchAll(/network-object object (\S+)/g)) if (!objects.has(m[1])) problems.push(`member ${m[1]}`);
  for (const acl of acls)
    if (!new RegExp(`^access-group ${acl} (in interface \\S+|global)$`, "m").test(config))
      problems.push(`access-group for ${acl}`);
  return problems;
}

export function checkpointReferenceProblems(config: string): string[] {
  const problems: string[] = [];
  const objs = new Set(["Any"]);
  for (const m of config.matchAll(/mgmt_cli add (?:host|network|address-range|group|dns-domain) name "([^"]+)"/g)) objs.add(m[1]);
  const svcs = new Set(["Any", ...CHECKPOINT_PREDEFINED_SERVICES]);
  for (const m of config.matchAll(/mgmt_cli add service-(?:tcp|udp|icmp) name "([^"]+)"/g)) svcs.add(m[1]);
  for (const m of config.matchAll(/(source|destination)\.\d+ "([^"]+)"/g))
    if (!objs.has(m[2])) problems.push(`${m[1]} ${m[2]}`);
  for (const m of config.matchAll(/service\.\d+ "([^"]+)"/g)) if (!svcs.has(m[1])) problems.push(`service ${m[1]}`);
  for (const m of config.matchAll(/members\.\d+ "([^"]+)"/g)) if (!objs.has(m[1])) problems.push(`member ${m[1]}`);
  return problems;
}

export function panosReferenceProblems(config: string): string[] {
  const problems: string[] = [];
  const addrs = new Set(["any"]);
  for (const m of config.matchAll(/^set address(?:-group)? "([^"]+)"/gm)) addrs.add(m[1]);
  const svcs = new Set(["any", "application-default", ...PANOS_PREDEFINED_SERVICES]);
  for (const m of config.matchAll(/^set service "([^"]+)"/gm)) svcs.add(m[1]);
  const rules = new Map<string, { app: string[]; svc: string[] }>();
  for (const m of config.matchAll(/^set rulebase security rules "([^"]+)" (source|destination|service|application) \[ (.+) \]$/gm)) {
    const vals = quoted(m[3]);
    const r = rules.get(m[1]) ?? { app: [], svc: [] };
    if (m[2] === "service") {
      r.svc = vals;
      for (const v of vals) if (!svcs.has(v)) problems.push(`service ${v}`);
    } else if (m[2] === "application") r.app = vals;
    else for (const v of vals) if (!addrs.has(v)) problems.push(`address ${v}`);
    rules.set(m[1], r);
  }
  for (const m of config.matchAll(/static \[ (.+) \]/g))
    for (const v of quoted(m[1])) if (!addrs.has(v)) problems.push(`member ${v}`);
  return problems;
}

export const REFERENCE_CHECKS: Record<FirewallVendor, (c: string) => string[]> = {
  FORTINET: fortiosReferenceProblems,
  JUNIPER_SRX: junosReferenceProblems,
  CISCO_ASA: asaReferenceProblems,
  CHECKPOINT: checkpointReferenceProblems,
  PALO_ALTO: panosReferenceProblems,
};

/** Keywords of one vendor that must never appear in another vendor's output */
export const FOREIGN_TOKENS: Record<FirewallVendor, RegExp[]> = {
  FORTINET: [/application-default/, /service-https?\b/, /junos-/, /set (srcaddr|dstaddr|service) .*"any"/],
  JUNIPER_SRX: [/application-default/, /service-https?\b/, /match \S+ (all|ALL)$/m, /"ALL"/],
  CISCO_ASA: [/application-default/, /service-https?\b/, /junos-/, /"ALL"/, /^access-list \S+ extended .* all( |$)/m],
  CHECKPOINT: [/application-default/, /service-https?\b/, /junos-/, /"ALL"/, /"any"/],
  PALO_ALTO: [/junos-/, /"ALL"/, /"all"/, /set srcaddr/],
};
