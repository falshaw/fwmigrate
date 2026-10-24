/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Shared plumbing for all generators: address classification, object
 * collection, per-rule review flags and confidence.
 */

import type {
  FirewallVendor,
  NormalizedObject,
  NormalizedRule,
} from "../parsers/types";
import type {
  GenerateOptions,
  GeneratorResult,
  IConfigGenerator,
  RollbackCommand,
  RuleConfig,
  ZoneMapping,
} from "./GeneratorInterface";
import {
  isAnyToken,
  resolveServices,
  applyPlatformServices,
  type ResolvedService,
  type ServiceResolution,
} from "./services";

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export type AddressRef =
  | { kind: "any" }
  | { kind: "object"; name: string; obj: NormalizedObject }
  | { kind: "host"; ip: string }
  | { kind: "subnet"; ip: string; prefix: number }
  | { kind: "range"; start: string; end: string }
  | { kind: "fqdn"; fqdn: string }
  | { kind: "unknown"; name: string };

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;

/** Classify a literal value (address object member or rule token). */
export function classifyLiteral(value: string): AddressRef | null {
  const v = value.trim();
  if (IPV4.test(v)) return { kind: "host", ip: v };
  const cidr = v.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (cidr) {
    const prefix = parseInt(cidr[2], 10);
    return prefix === 32
      ? { kind: "host", ip: cidr[1] }
      : { kind: "subnet", ip: cidr[1], prefix };
  }
  const range = v.match(/^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (range) return { kind: "range", start: range[1], end: range[2] };
  if (/^(?=.*[a-z])[a-z0-9*]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v) && v.includes("."))
    return { kind: "fqdn", fqdn: v };
  return null;
}

export function classifyAddress(
  token: string,
  objects: Map<string, NormalizedObject>,
): AddressRef {
  if (isAnyToken(token)) return { kind: "any" };
  const obj = objects.get(token);
  if (obj && (obj.objectType === "address" || obj.objectType === "address-group"))
    return { kind: "object", name: token, obj };
  return classifyLiteral(token) ?? { kind: "unknown", name: token };
}

/** Name for an object created from a literal in a rule (valid on every target). */
export function literalObjectName(ref: AddressRef): string {
  switch (ref.kind) {
    case "host":
      return `h-${ref.ip}`;
    case "subnet":
      return `n-${ref.ip}_${ref.prefix}`;
    case "range":
      return `r-${ref.start}-${ref.end}`;
    case "fqdn":
      return `fqdn-${ref.fqdn}`;
    default:
      return "";
  }
}

export function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
  return [24, 16, 8, 0].map((s) => (mask >>> s) & 255).join(".");
}

export function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Generation context
// ---------------------------------------------------------------------------

export interface AddressDef {
  name: string;
  ref: Exclude<AddressRef, { kind: "any" } | { kind: "object" } | { kind: "unknown" }>;
}

export interface GroupDef {
  name: string;
  members: string[];
}

/**
 * Value of the placeholder object created for a name the source config
 * references but never defines. The limited broadcast address never matches
 * unicast traffic, and the rule using it is emitted disabled; the placeholder
 * only lets the target accept the config. Replace it before enabling the rule.
 */
export const PLACEHOLDER_ADDRESS = "255.255.255.255";

export class GenContext {
  readonly objects: Map<string, NormalizedObject>;
  /** Names that got a placeholder object (see PLACEHOLDER_ADDRESS) */
  readonly placeholders = new Set<string>();
  readonly zoneMappings: ZoneMapping[];
  /** Ordered address definitions to emit (source objects + literals) */
  readonly addresses = new Map<string, AddressDef>();
  /** Ordered groups (members always emitted before the group) */
  readonly groups = new Map<string, GroupDef>();
  /** Custom services the target needs (keyed by target name) */
  readonly customServices = new Map<string, ResolvedService>();
  /** Generator-specific extra definitions (e.g. ASA object-groups) */
  readonly extra: string[] = [];
  /** Generator-specific state (e.g. ASA access-group bindings) */
  readonly meta = new Map<string, unknown>();

  constructor(objects: NormalizedObject[], zoneMappings: ZoneMapping[]) {
    this.objects = new Map(objects.map((o) => [o.name, o]));
    this.zoneMappings = zoneMappings;
  }

  mapZone(zone: string | undefined): string | undefined {
    if (!zone || isAnyToken(zone)) return undefined;
    const m = this.zoneMappings.find(
      (z) => z.sourceZone.toLowerCase() === zone.toLowerCase(),
    );
    return m?.targetZone || zone;
  }

  /**
   * Register what a rule address token needs and return the name the target
   * should reference, or null for any. Unknown names are returned as-is and
   * reported through `unknown`.
   */
  useAddress(token: string, unknown: string[]): string | null {
    const ref = classifyAddress(token, this.objects);
    if (ref.kind === "any") return null;
    if (ref.kind === "unknown") {
      unknown.push(token);
      this.placeholder(token);
      return token;
    }
    if (ref.kind === "object") {
      this.registerObject(ref.obj, unknown, 0);
      return ref.name;
    }
    const name = literalObjectName(ref);
    if (!this.addresses.has(name)) this.addresses.set(name, { name, ref });
    return name;
  }

  private registerObject(obj: NormalizedObject, unknown: string[], depth: number) {
    if (depth > 8) return;
    if (obj.objectType === "address") {
      if (this.addresses.has(obj.name)) return;
      const lit = obj.members.map(classifyLiteral).find(Boolean);
      if (lit && lit.kind !== "any" && lit.kind !== "object" && lit.kind !== "unknown") {
        this.addresses.set(obj.name, { name: obj.name, ref: lit });
      } else {
        unknown.push(obj.name);
        this.placeholder(obj.name);
      }
      return;
    }
    if (obj.objectType === "address-group") {
      if (this.groups.has(obj.name)) return;
      const members: string[] = [];
      for (const m of obj.members) {
        const child = this.objects.get(m);
        if (child) {
          this.registerObject(child, unknown, depth + 1);
          members.push(m);
          continue;
        }
        const lit = classifyLiteral(m);
        if (lit && lit.kind !== "any" && lit.kind !== "object" && lit.kind !== "unknown") {
          const name = literalObjectName(lit);
          if (!this.addresses.has(name)) this.addresses.set(name, { name, ref: lit });
          members.push(name);
        } else {
          unknown.push(m);
        }
      }
      this.groups.set(obj.name, { name: obj.name, members });
    }
  }

  private placeholder(name: string) {
    if (this.addresses.has(name)) return;
    this.placeholders.add(name);
    this.addresses.set(name, { name, ref: { kind: "host", ip: PLACEHOLDER_ADDRESS } });
  }
}

// ---------------------------------------------------------------------------
// Per-rule analysis shared by all targets
// ---------------------------------------------------------------------------

export interface RuleTranslation {
  config: string;
  warnings: string[];
  confidence: number;
  explanation: string;
}

export interface RuleFacts {
  services: ServiceResolution;
  warnings: string[];
  penalty: number;
  /** The rule must be emitted disabled: its match criteria could not be resolved */
  forceDisable: boolean;
}

/**
 * Review flags common to every target. Generators add target-specific ones.
 */
export function analyseRule(
  rule: NormalizedRule,
  ctx: GenContext,
  target: FirewallVendor,
): RuleFacts {
  const services = resolveServices(rule, ctx.objects);
  applyPlatformServices(services, target);
  const warnings: string[] = [];
  let penalty = 0;
  let forceDisable = false;
  const keepsAppId = target === "PALO_ALTO";

  if (services.unmappedApps.length) {
    warnings.push(
      `REVIEW: App-ID ${services.unmappedApps.join(", ")} has no standard port mapping — add the service manually.`,
    );
    penalty += 0.3;
  }
  if (services.unresolvedServices.length) {
    warnings.push(
      `REVIEW: service ${services.unresolvedServices.join(", ")} is not defined in the source config and has no known equivalent.`,
    );
    penalty += 0.25;
  }
  if (services.unresolvable) {
    warnings.push(
      "REVIEW: no service could be resolved — rule emitted DISABLED with service any; set the correct service before enabling.",
    );
    forceDisable = true;
  }
  if (services.applications.length && !keepsAppId) {
    if (services.fromApplicationDefault) {
      warnings.push(
        `App-ID ${services.applications.join(", ")} converted to its default ports; layer-7 application enforcement is not carried over.`,
      );
      penalty += 0.05;
    } else if (services.any) {
      warnings.push(
        `REVIEW: source rule restricts App-ID (${services.applications.join(", ")}) on any port; the port-based translation allows every service.`,
      );
      penalty += 0.25;
    } else {
      warnings.push(
        `App-ID ${services.applications.join(", ")} is not enforced on the target; only the explicit services are kept.`,
      );
      penalty += 0.05;
    }
  }
  if (services.fromApplicationDefault && services.any && services.applications.length === 0) {
    warnings.push("application-default with application any matches any port.");
    penalty += 0.05;
  }

  const anySrc = rule.sources.every(isAnyToken);
  const anyDst = rule.destinations.every(isAnyToken);
  if (rule.enabled && rule.action === "permit" && anySrc && anyDst && services.any) {
    warnings.push("REVIEW: permit any/any/any — overly permissive.");
  }

  return { services, warnings, penalty, forceDisable };
}

export function confidenceFrom(facts: RuleFacts, extraPenalty = 0, unknownAddrs = 0): number {
  // Emitted disabled (unresolved service or undefined address): needs a human.
  if (facts.forceDisable || unknownAddrs > 0) return 0.3;
  const c = 0.95 - facts.penalty - extraPenalty - unknownAddrs * 0.2;
  return Math.max(0.1, Math.min(0.95, Math.round(c * 100) / 100));
}

export function unknownAddressWarning(unknown: string[]): string[] {
  if (!unknown.length) return [];
  return [
    `REVIEW: address ${[...new Set(unknown)].join(", ")} is referenced but not defined in the source config — rule emitted DISABLED with a placeholder object (${PLACEHOLDER_ADDRESS}/32) so the config loads; set the real address before enabling it.`,
  ];
}

/**
 * Why the migration emits this rule disabled, or "" when it does not. A rule
 * whose service could not be resolved, or that references an address defined
 * nowhere, would be rejected by the target (or match the wrong traffic), so it
 * is never emitted live.
 */
export function disableReason(facts: RuleFacts, unknown: string[], verb = "disabled"): string {
  if (facts.forceDisable) return `REVIEW: service unresolved, ${verb} by migration`;
  if (unknown.length)
    return `REVIEW: address ${[...new Set(unknown)].join(", ")} not defined, ${verb} by migration`;
  return "";
}

export function describeRule(
  rule: NormalizedRule,
  facts: RuleFacts,
  targetLabel: string,
): string {
  const svc = facts.services.any
    ? "any service"
    : facts.services.services
        .map((s) => (s.key && s.origin !== "object" ? s.key.toUpperCase() : s.label))
        .join(", ");
  const verb = rule.action === "permit" ? "Allow" : "Block";
  const from = rule.sourceZone && !isAnyToken(rule.sourceZone) ? ` (${rule.sourceZone}` : " (any";
  const to = rule.destinationZone && !isAnyToken(rule.destinationZone) ? ` -> ${rule.destinationZone})` : " -> any)";
  return `${verb} ${rule.sources.join(", ")} to ${rule.destinations.join(", ")} on ${svc}${from}${to}; translated to ${targetLabel}${rule.enabled ? "" : " (disabled)"}.`;
}

// ---------------------------------------------------------------------------
// Base generator
// ---------------------------------------------------------------------------

export abstract class BaseGenerator implements IConfigGenerator {
  abstract vendor: FirewallVendor;
  /** Line comment prefix in the target syntax */
  abstract commentPrefix: string;
  protected abstract targetLabel: string;

  protected abstract translateRule(
    rule: NormalizedRule,
    ctx: GenContext,
  ): RuleTranslation;

  /** Object/service definitions collected in ctx while translating rules */
  protected abstract renderObjects(ctx: GenContext): string[];

  /** Wrap the per-rule blocks (e.g. FortiOS `config firewall policy … end`) */
  protected wrapRules(blocks: string[], _ctx: GenContext): string[] {
    return blocks;
  }

  abstract generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
    objects?: NormalizedObject[],
  ): RollbackCommand;

  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
    options: GenerateOptions = {},
  ): Promise<GeneratorResult> {
    const ctx = new GenContext(objects, zoneMappings);
    const ruleConfigs: RuleConfig[] = [];
    const blocks: string[] = [];
    const warnings: string[] = [];

    for (const rule of rules) {
      const t = this.translateRule(rule, ctx);
      const override = options.overrides?.[rule.position];
      ruleConfigs.push({
        position: rule.position,
        ruleName: rule.name,
        config: t.config,
        explanation: t.explanation,
        warnings: t.warnings,
        confidence: t.confidence,
      });
      blocks.push(override ?? t.config);
    }

    const objectLines = this.renderObjects(ctx);
    const p = this.commentPrefix;
    const lines = [
      ...(objectLines.length ? [`${p} --- Objects ---`, ...objectLines, ""] : []),
      `${p} --- Rules ---`,
      ...this.wrapRules(blocks, ctx),
    ];

    return {
      config: lines.join("\n"),
      ruleConfigs,
      warnings,
      objectsCreated: [...ctx.addresses.keys(), ...ctx.groups.keys(), ...ctx.customServices.keys()],
    };
  }

  generateRule(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
    objects: NormalizedObject[] = [],
  ): string {
    return this.translateRule(rule, new GenContext(objects, zoneMappings)).config;
  }
}
