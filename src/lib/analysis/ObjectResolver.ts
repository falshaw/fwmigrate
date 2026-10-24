/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Resolves the names a rule references (address objects, address groups
 * with nesting, service objects and service groups, PAN-OS App-IDs with
 * application-default) into sets that can be compared: IPv4 ranges, FQDNs,
 * and TCP/UDP port ranges plus ICMP types.
 *
 * The analysis engine compares these sets, never the raw names, so a rule
 * on "web-servers" is seen to overlap a rule on "203.0.113.10/32".
 */

import type { NormalizedObject, NormalizedRule } from "../parsers/types";
import { isAnyToken, resolveServices } from "../generators/services";
import { cidrToRange, ipToBigInt, type IPRange } from "./NetworkUtils";

const MAX_DEPTH = 16;
const FULL_V4: IPRange = { start: 0n, end: (1n << 32n) - 1n };

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

export interface NumRange {
  start: number;
  end: number;
}

/** Sort and merge touching/overlapping ranges. */
function mergeBig(ranges: IPRange[]): IPRange[] {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: IPRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1n) {
      if (r.end > last.end) last.end = r.end;
    } else out.push({ ...r });
  }
  return out;
}

function mergeNum(ranges: NumRange[]): NumRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: NumRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1) {
      if (r.end > last.end) last.end = r.end;
    } else out.push({ ...r });
  }
  return out;
}

/** Every range of `inner` lies inside the union of `outer` (both merged). */
function coversRanges<T extends bigint | number>(
  outer: { start: T; end: T }[],
  inner: { start: T; end: T }[],
): boolean {
  return inner.every((i) => outer.some((o) => o.start <= i.start && o.end >= i.end));
}

function intersectsRanges<T extends bigint | number>(
  a: { start: T; end: T }[],
  b: { start: T; end: T }[],
): boolean {
  return a.some((x) => b.some((y) => x.start <= y.end && y.start <= x.end));
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export interface AddressSet {
  any: boolean;
  /** Merged IPv4 ranges */
  ranges: IPRange[];
  /** FQDN objects, compared by name (lower case) */
  fqdns: Set<string>;
  /** Names that are neither literals nor defined objects */
  unresolved: string[];
}

/** Lookup by exact name first, then case-insensitively (ASA/FortiOS names are often upper case). */
export class ObjectIndex {
  private exact = new Map<string, NormalizedObject>();
  private lower = new Map<string, NormalizedObject>();

  constructor(objects: NormalizedObject[]) {
    for (const o of objects) {
      // Address and service namespaces can share names (e.g. Check Point "dns");
      // keep both by prefixing the kind.
      const kind = o.objectType.startsWith("service") ? "svc" : "addr";
      this.exact.set(`${kind}:${o.name}`, o);
      if (!this.lower.has(`${kind}:${o.name.toLowerCase()}`))
        this.lower.set(`${kind}:${o.name.toLowerCase()}`, o);
    }
  }

  address(name: string): NormalizedObject | undefined {
    return this.exact.get(`addr:${name}`) ?? this.lower.get(`addr:${name.toLowerCase()}`);
  }

  /** Map that resolveServices() expects (service objects only, exact names plus lower-case aliases). */
  serviceMap(): Map<string, NormalizedObject> {
    const m = new Map<string, NormalizedObject>();
    for (const [k, o] of this.lower) if (k.startsWith("svc:")) m.set(o.name.toLowerCase(), o);
    for (const [k, o] of this.exact) if (k.startsWith("svc:")) m.set(o.name, o);
    return m;
  }
}

function parseLiteralAddress(token: string): IPRange | null {
  const t = token.trim();
  if (t === "0.0.0.0/0") return FULL_V4;
  // a.b.c.d-e.f.g.h
  const dash = t.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dash) {
    const s = ipToBigInt(dash[1]);
    const e = ipToBigInt(dash[2]);
    if (s === -1n || e === -1n || e < s) return null;
    return { start: s, end: e };
  }
  // a.b.c.d mask (ASA / FortiOS "subnet 192.0.2.0 255.255.255.0")
  const sp = t.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (sp) {
    const mask = ipToBigInt(sp[2]);
    if (mask === -1n) return null;
    const bits = mask.toString(2).replace(/0+$/, "");
    if (/0/.test(bits)) return null;
    return cidrToRange(`${sp[1]}/${bits.length}`);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(t)) return cidrToRange(t);
  return null;
}

const FQDN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function resolveAddresses(tokens: string[], index: ObjectIndex): AddressSet {
  const set: AddressSet = { any: false, ranges: [], fqdns: new Set(), unresolved: [] };
  const seen = new Set<string>();

  const visit = (token: string, depth: number, fromObject: boolean) => {
    const t = token.trim();
    if (!t) return;
    if (isAnyToken(t) || t.toLowerCase() === "any-ipv4") {
      set.any = true;
      return;
    }
    const literal = parseLiteralAddress(t);
    if (literal) {
      set.ranges.push(literal);
      return;
    }
    const obj = index.address(t);
    if (obj && depth < MAX_DEPTH) {
      if (seen.has(obj.name)) return; // group loop or repeated member
      seen.add(obj.name);
      if (obj.members.length === 0) set.unresolved.push(t);
      for (const m of obj.members) visit(m, depth + 1, true);
      return;
    }
    // FQDN objects keep the host name as their only member
    if (fromObject && FQDN_RE.test(t)) {
      set.fqdns.add(t.toLowerCase());
      return;
    }
    set.unresolved.push(t);
  };

  for (const t of tokens.length ? tokens : ["any"]) visit(t, 0, false);
  set.ranges = mergeBig(set.ranges);
  if (set.ranges.some((r) => r.start === 0n && r.end === FULL_V4.end)) set.any = true;
  return set;
}

export function addressCovers(a: AddressSet, b: AddressSet): boolean {
  if (a.any) return true;
  if (b.any || b.unresolved.length) return false;
  if (!coversRanges(a.ranges, b.ranges)) return false;
  for (const f of b.fqdns) if (!a.fqdns.has(f)) return false;
  return true;
}

export function addressIntersects(a: AddressSet, b: AddressSet): boolean {
  if (a.any || b.any) return true;
  if (intersectsRanges(a.ranges, b.ranges)) return true;
  for (const f of a.fqdns) if (b.fqdns.has(f)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Services (+ PAN-OS App-IDs)
// ---------------------------------------------------------------------------

export interface ServiceSet {
  any: boolean;
  tcp: NumRange[];
  udp: NumRange[];
  /** true = every ICMP type */
  icmpAll: boolean;
  icmpTypes: Set<number>;
  /** Restricting App-IDs (PAN-OS); null = any application */
  apps: Set<string> | null;
  unresolved: string[];
}

function portRange(ports: string | undefined): NumRange {
  if (!ports) return { start: 0, end: 65535 };
  const [a, b] = ports.split("-").map((p) => parseInt(p, 10));
  return { start: a, end: Number.isFinite(b) ? b : a };
}

export function resolveRuleServices(rule: NormalizedRule, index: ObjectIndex): ServiceSet {
  const res = resolveServices(rule, index.serviceMap());
  const apps = res.applications.length
    ? new Set(res.applications.map((a) => a.toLowerCase()))
    : null;
  const set: ServiceSet = {
    any: res.any,
    tcp: [],
    udp: [],
    icmpAll: false,
    icmpTypes: new Set(),
    apps,
    unresolved: [...res.unresolvedServices, ...res.unmappedApps],
  };
  for (const s of res.services) {
    for (const spec of s.specs) {
      if (spec.proto === "icmp") {
        if (spec.icmpType === undefined) set.icmpAll = true;
        else set.icmpTypes.add(spec.icmpType);
      } else set[spec.proto].push(portRange(spec.ports));
    }
  }
  set.tcp = mergeNum(set.tcp);
  set.udp = mergeNum(set.udp);
  // tcp 1-65535 + udp 1-65535 + all ICMP is "any" for the purpose of the checks
  const full = (r: NumRange[]) => r.some((x) => x.start <= 1 && x.end >= 65535);
  if (!set.any && full(set.tcp) && full(set.udp) && set.icmpAll) set.any = true;
  return set;
}

function appsCover(a: Set<string> | null, b: Set<string> | null): boolean {
  if (a === null) return true;
  if (b === null) return false;
  for (const x of b) if (!a.has(x)) return false;
  return true;
}

function appsIntersect(a: Set<string> | null, b: Set<string> | null): boolean {
  if (a === null || b === null) return true;
  for (const x of b) if (a.has(x)) return true;
  return false;
}

export function serviceCovers(a: ServiceSet, b: ServiceSet): boolean {
  if (!appsCover(a.apps, b.apps)) return false;
  if (a.any) return true;
  if (b.any || b.unresolved.length) return false;
  if (!coversRanges(a.tcp, b.tcp) || !coversRanges(a.udp, b.udp)) return false;
  if (b.icmpAll && !a.icmpAll) return false;
  if (!a.icmpAll) for (const t of b.icmpTypes) if (!a.icmpTypes.has(t)) return false;
  return true;
}

export function serviceIntersects(a: ServiceSet, b: ServiceSet): boolean {
  if (!appsIntersect(a.apps, b.apps)) return false;
  if (a.any || b.any) return true;
  if (intersectsRanges(a.tcp, b.tcp) || intersectsRanges(a.udp, b.udp)) return true;
  const aIcmp = a.icmpAll || a.icmpTypes.size > 0;
  const bIcmp = b.icmpAll || b.icmpTypes.size > 0;
  if (aIcmp && bIcmp) {
    if (a.icmpAll || b.icmpAll) return true;
    for (const t of a.icmpTypes) if (b.icmpTypes.has(t)) return true;
  }
  return false;
}

/** The rule matches every service and every application. */
export function serviceIsAny(s: ServiceSet): boolean {
  return s.any && s.apps === null;
}

// ---------------------------------------------------------------------------
// Whole rule
// ---------------------------------------------------------------------------

export interface ResolvedRule {
  rule: NormalizedRule;
  src: AddressSet;
  dst: AddressSet;
  svc: ServiceSet;
  /** Rules are only compared inside one scope (an ASA access list; "" elsewhere). */
  scope: string;
  /** Every name that could not be resolved, for the report */
  unresolved: string[];
}

export function resolveRule(rule: NormalizedRule, index: ObjectIndex): ResolvedRule {
  const src = resolveAddresses(rule.sources, index);
  const dst = resolveAddresses(rule.destinations, index);
  const svc = resolveRuleServices(rule, index);
  const acl = rule.rawVendorData?.aclName;
  return {
    rule,
    src,
    dst,
    svc,
    scope: typeof acl === "string" ? acl : "",
    unresolved: [...new Set([...src.unresolved, ...dst.unresolved, ...svc.unresolved])],
  };
}
