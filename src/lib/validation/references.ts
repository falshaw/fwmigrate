/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Reference checks: every name a rule uses must be a predefined object of the
 * platform or be defined in the same config. A device rejects a policy that
 * references an object it does not know, even a disabled one, so these are
 * errors. Used by the config validator and by the generator tests.
 */

import { SERVICE_CATALOG } from "../generators/services";
import type { FirewallVendor } from "../vendors";

const names = (key: "fortinet" | "junos" | "checkpoint" | "panos") =>
  new Set(
    Object.values(SERVICE_CATALOG)
      .map((e) => e.names[key])
      .filter((n): n is string => !!n),
  );

export const FORTIOS_PREDEFINED_SERVICES = new Set([
  ...names("fortinet"),
  "ALL",
  "ALL_TCP",
  "ALL_UDP",
  "ALL_ICMP",
  "ALL_ICMP6",
]);
/** Address objects every FortiGate has out of the box */
export const FORTIOS_PREDEFINED_ADDRESSES = new Set([
  "all",
  "none",
  "FIREWALL_AUTH_PORTAL_ADDRESS",
  "SSLVPN_TUNNEL_ADDR1",
  "FABRIC_DEVICE",
]);
export const JUNOS_PREDEFINED_APPS = new Set([...names("junos"), "junos-dns-udp", "junos-dns-tcp"]);
export const CHECKPOINT_PREDEFINED_SERVICES = new Set([...names("checkpoint"), "domain-udp", "domain-tcp"]);
export const PANOS_PREDEFINED_SERVICES = new Set(["service-http", "service-https"]);

/** One unresolved reference; `ref` is the kind and name, e.g. "address nms-poller" */
export interface ReferenceProblem {
  ref: string;
  /** "error": the device rejects it; "warning": it loads but does nothing */
  severity: "error" | "warning";
}

const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const err = (ref: string): ReferenceProblem => ({ ref, severity: "error" });

function fortios(config: string): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const section = (hdr: string) => {
    const out = new Set<string>();
    for (const m of config.matchAll(new RegExp(`^\\s*config ${hdr}\\n`, "gm"))) {
      const start = m.index! + m[0].length;
      const end = config.slice(start).search(/^\s*end\s*$/m);
      const body = end < 0 ? config.slice(start) : config.slice(start, start + end);
      for (const e of body.matchAll(/^\s+edit "([^"]+)"/gm)) out.add(e[1]);
    }
    return out;
  };
  const addrs = new Set([
    ...section("firewall address"),
    ...section("firewall addrgrp"),
    ...section("firewall vip"),
    ...section("firewall vipgrp"),
    ...FORTIOS_PREDEFINED_ADDRESSES,
  ]);
  const svcs = new Set([
    ...section("firewall service custom"),
    ...section("firewall service group"),
    ...FORTIOS_PREDEFINED_SERVICES,
  ]);
  for (const m of config.matchAll(/set (srcaddr|dstaddr) (.+)/g))
    for (const n of quoted(m[2])) if (!addrs.has(n)) problems.push(err(`address ${n}`));
  for (const m of config.matchAll(/set service (.+)/g))
    for (const n of quoted(m[1])) if (!svcs.has(n)) problems.push(err(`service ${n}`));
  for (const m of config.matchAll(/set member (.+)/g))
    for (const n of quoted(m[1])) if (!addrs.has(n) && !svcs.has(n)) problems.push(err(`group member ${n}`));
  return problems;
}

function junos(config: string): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const addrs = new Set(["any", "any-ipv4", "any-ipv6"]);
  for (const m of config.matchAll(/address-book (?:global )?address(?:-set)? (\S+) /g)) addrs.add(m[1]);
  const apps = new Set(["any", ...JUNOS_PREDEFINED_APPS]);
  for (const m of config.matchAll(/set applications application(?:-set)? (\S+) /g)) apps.add(m[1]);
  for (const m of config.matchAll(/match (source|destination)-address (\S+)/g))
    if (!addrs.has(m[2])) problems.push(err(`address ${m[2]}`));
  for (const m of config.matchAll(/match application (\S+)/g))
    // junos-* names are predefined on the platform (hundreds of them)
    if (!apps.has(m[1]) && !m[1].startsWith("junos-")) problems.push(err(`application ${m[1]}`));
  return problems;
}

function asa(config: string): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const objects = new Set<string>();
  const groups = new Set<string>();
  for (const m of config.matchAll(/^object (?:network|service) (\S+)/gm)) objects.add(m[1]);
  for (const m of config.matchAll(/^object-group (?:network|service|protocol|icmp-type) (\S+)/gm)) groups.add(m[1]);
  const acls = new Set<string>();
  for (const line of config.split("\n")) {
    const ace = line.match(/^access-list (\S+) extended /);
    if (!ace) continue;
    acls.add(ace[1]);
    for (const m of line.matchAll(/\bobject (\S+)/g)) if (!objects.has(m[1])) problems.push(err(`object ${m[1]}`));
    for (const m of line.matchAll(/\bobject-group (\S+)/g)) if (!groups.has(m[1])) problems.push(err(`object-group ${m[1]}`));
  }
  for (const m of config.matchAll(/network-object object (\S+)/g))
    if (!objects.has(m[1])) problems.push(err(`member ${m[1]}`));
  for (const acl of acls)
    if (!new RegExp(`^access-group ${acl} (in|out) interface \\S+$|^access-group ${acl} global$`, "m").test(config))
      problems.push({ ref: `access-group for ${acl} (the ACL is not applied anywhere)`, severity: "warning" });
  return problems;
}

function checkpoint(config: string): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const objs = new Set(["Any"]);
  for (const m of config.matchAll(/mgmt_cli add (?:host|network|address-range|group|dns-domain) name "([^"]+)"/g)) objs.add(m[1]);
  const svcs = new Set(["Any", ...CHECKPOINT_PREDEFINED_SERVICES]);
  for (const m of config.matchAll(/mgmt_cli add service-(?:tcp|udp|icmp|group) name "([^"]+)"/g)) svcs.add(m[1]);
  for (const m of config.matchAll(/(source|destination)\.\d+ "([^"]+)"/g))
    if (!objs.has(m[2])) problems.push(err(`${m[1]} ${m[2]}`));
  for (const m of config.matchAll(/service\.\d+ "([^"]+)"/g)) if (!svcs.has(m[1])) problems.push(err(`service ${m[1]}`));
  for (const m of config.matchAll(/members\.\d+ "([^"]+)"/g))
    if (!objs.has(m[1]) && !svcs.has(m[1])) problems.push(err(`member ${m[1]}`));
  return problems;
}

function panos(config: string): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const addrs = new Set(["any"]);
  for (const m of config.matchAll(/^set address(?:-group)? "?([^"\s]+)"?/gm)) addrs.add(m[1]);
  const svcs = new Set(["any", "application-default", ...PANOS_PREDEFINED_SERVICES]);
  for (const m of config.matchAll(/^set service(?:-group)? "?([^"\s]+)"?/gm)) svcs.add(m[1]);
  for (const m of config.matchAll(/^set rulebase security rules "([^"]+)" (source|destination|service) \[ (.+) \]$/gm)) {
    const vals = quoted(m[3]);
    if (m[2] === "service") {
      for (const v of vals) if (!svcs.has(v)) problems.push(err(`service ${v}`));
    } else {
      for (const v of vals) if (!addrs.has(v)) problems.push(err(`address ${v}`));
    }
  }
  for (const m of config.matchAll(/static \[ (.+) \]/g))
    for (const v of quoted(m[1])) if (!addrs.has(v)) problems.push(err(`member ${v}`));
  return problems;
}

export const REFERENCE_CHECKS: Record<FirewallVendor, (config: string) => ReferenceProblem[]> = {
  FORTINET: fortios,
  JUNIPER_SRX: junos,
  CISCO_ASA: asa,
  CHECKPOINT: checkpoint,
  PALO_ALTO: panos,
};

/** Every unresolved reference in `config`, each name reported once. */
export function referenceProblems(config: string, vendor: string): ReferenceProblem[] {
  const check = (REFERENCE_CHECKS as Record<string, (c: string) => ReferenceProblem[]>)[vendor];
  if (!check) return [];
  const seen = new Set<string>();
  return check(config).filter((p) => !seen.has(p.ref) && seen.add(p.ref));
}
