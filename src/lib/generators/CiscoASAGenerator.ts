/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Cisco ASA (8.3+) CLI generator: network/service objects, object-groups,
 * extended ACEs per ingress interface and the matching access-group lines.
 */

import type { RollbackCommand, ZoneMapping } from "./GeneratorInterface";
import type { FirewallVendor, NormalizedObject, NormalizedRule } from "../parsers/types";
import {
  BaseGenerator,
  GenContext,
  analyseRule,
  confidenceFrom,
  disableReason,
  describeRule,
  prefixToMask,
  unknownAddressWarning,
  type RuleTranslation,
} from "./base";
import { classifyLiteral } from "./base";
import type { ServiceSpec } from "./services";

const GLOBAL_ACL = "global_access";

function asaName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
}

function portOp(ports: string): string {
  const [a, b] = ports.split("-");
  return b ? `range ${a} ${b}` : `eq ${a}`;
}

function icmpType(spec: ServiceSpec): string {
  if (spec.icmpType === undefined) return "";
  return spec.icmpType === 8 ? " echo" : ` ${spec.icmpType}`;
}

export class CiscoASAGenerator extends BaseGenerator {
  vendor: FirewallVendor = "CISCO_ASA";
  commentPrefix = "!";
  protected targetLabel = "a Cisco ASA extended ACE";

  private aclFor(rule: NormalizedRule, ctx: GenContext): { acl: string; iface?: string } {
    const original = rule.rawVendorData?.aclName as string | undefined;
    const iface = ctx.mapZone(rule.sourceZone);
    if (iface) return { acl: original ?? `${asaName(iface)}_access_in`, iface: asaName(iface) };
    if (original) return { acl: original };
    return { acl: GLOBAL_ACL };
  }

  protected translateRule(rule: NormalizedRule, ctx: GenContext): RuleTranslation {
    const facts = analyseRule(rule, ctx, this.vendor);
    const warnings = [...facts.warnings];
    const unknown: string[] = [];
    const ruleId = asaName(rule.name);
    const defs: string[] = [];

    const { acl, iface } = this.aclFor(rule, ctx);
    const bindings = (ctx.meta.get("bindings") as Map<string, string | undefined>) ?? new Map();
    bindings.set(acl, iface);
    ctx.meta.set("bindings", bindings);
    if (acl === GLOBAL_ACL)
      warnings.push(
        "REVIEW: source zone any -> global ACL, which the ASA evaluates after every interface ACL; check that the rule order still holds.",
      );
    const dstZone = ctx.mapZone(rule.destinationZone);
    if (dstZone)
      warnings.push(`ASA ACLs filter on the ingress interface; destination zone "${dstZone}" is enforced by routing only.`);

    // Host/subnet literals are written inline; everything else is an object
    type Op = { inline: string; member: string } | null;
    const toOp = (t: string): Op => {
      const lit = classifyLiteral(t);
      if (lit?.kind === "host") return { inline: `host ${lit.ip}`, member: ` network-object host ${lit.ip}` };
      if (lit?.kind === "subnet") {
        const m = `${lit.ip} ${prefixToMask(lit.prefix)}`;
        return { inline: m, member: ` network-object ${m}` };
      }
      const name = ctx.useAddress(t, unknown);
      if (name === null) return null;
      return ctx.groups.has(name)
        ? { inline: `object-group ${name}`, member: ` group-object ${name}` }
        : { inline: `object ${name}`, member: ` network-object object ${name}` };
    };
    const operand = (tokens: string[], suffix: string): string => {
      const ops = tokens.map(toOp);
      if (ops.includes(null) || ops.length === 0) return "any";
      if (ops.length === 1) return ops[0]!.inline;
      const groupName = `${ruleId}_${suffix}`;
      defs.push(`object-group network ${groupName}`, ...ops.map((o) => o!.member));
      return `object-group ${groupName}`;
    };
    const src = operand(rule.sources, "src");
    const dst = operand(rule.destinations, "dst");

    let proto = "ip";
    let portPart = "";
    if (!facts.services.any && !facts.forceDisable) {
      const items = facts.services.services;
      const specs = items.flatMap((s) => s.specs);
      if (items.length === 1 && items[0].origin === "object") {
        // Keep the source's named service object
        const name = asaName(items[0].label);
        if (specs.length === 1) {
          defs.push(`object service ${name}`, ` service ${this.serviceBody(specs[0])}`);
          proto = `object ${name}`;
        } else {
          defs.push(`object-group service ${name}`, ...specs.map((s) => ` service-object ${this.serviceBody(s)}`));
          proto = `object-group ${name}`;
        }
      } else if (specs.length === 1) {
        const s = specs[0];
        proto = s.proto;
        portPart = s.proto === "icmp" ? icmpType(s) : ` ${portOp(s.ports!)}`;
      } else {
        const name = `${ruleId}_svc`;
        defs.push(`object-group service ${name}`, ...specs.map((s) => ` service-object ${this.serviceBody(s)}`));
        proto = `object-group ${name}`;
      }
    }

    ctx.extra.push(...defs);
    const action = rule.action === "permit" ? "permit" : "deny";
    let ace = `access-list ${acl} extended ${action} ${proto} ${src} ${dst}${portPart}`;
    if (rule.logging) ace += " log";
    if (!rule.enabled || disableReason(facts, unknown)) ace += " inactive";

    const remark = [rule.name, rule.description, facts.services.applications.length ? `App-ID: ${facts.services.applications.join(", ")}` : ""]
      .filter(Boolean)
      .join(" - ")
      .slice(0, 100);
    const lines = [`access-list ${acl} remark ${remark}`, ace];

    warnings.push(...unknownAddressWarning(unknown));
    return {
      config: lines.join("\n"),
      warnings,
      confidence: confidenceFrom(facts, acl === GLOBAL_ACL ? 0.05 : 0, new Set(unknown).size),
      explanation: describeRule(rule, facts, this.targetLabel),
    };
  }

  /** "tcp destination eq 443" / "icmp echo" */
  private serviceBody(s: ServiceSpec): string {
    if (s.proto === "icmp") return `icmp${icmpType(s)}`;
    return `${s.proto} destination ${portOp(s.ports!)}`;
  }

  protected renderObjects(ctx: GenContext): string[] {
    const out: string[] = [];
    for (const a of ctx.addresses.values()) {
      out.push(`object network ${a.name}`);
      switch (a.ref.kind) {
        case "host":
          out.push(` host ${a.ref.ip}`);
          break;
        case "subnet":
          out.push(` subnet ${a.ref.ip} ${prefixToMask(a.ref.prefix)}`);
          break;
        case "range":
          out.push(` range ${a.ref.start} ${a.ref.end}`);
          break;
        case "fqdn":
          out.push(` fqdn ${a.ref.fqdn}`);
          break;
      }
    }
    for (const g of ctx.groups.values()) {
      out.push(`object-group network ${g.name}`);
      for (const m of g.members)
        out.push(ctx.groups.has(m) ? ` group-object ${m}` : ` network-object object ${m}`);
    }
    // Dedupe rule-level definitions (same service object used by several rules)
    const seen = new Set<string>();
    let block: string[] = [];
    const flush = () => {
      if (block.length && !seen.has(block[0])) {
        seen.add(block[0]);
        out.push(...block);
      }
      block = [];
    };
    for (const line of ctx.extra) {
      if (!line.startsWith(" ")) flush();
      block.push(line);
    }
    flush();
    return out;
  }

  protected wrapRules(blocks: string[], ctx: GenContext): string[] {
    const bindings = (ctx.meta.get("bindings") as Map<string, string | undefined>) ?? new Map();
    const groups: string[] = [];
    for (const [acl, iface] of bindings) {
      groups.push(iface ? `access-group ${acl} in interface ${iface}` : `access-group ${acl} global`);
    }
    return [...blocks, "", "! --- Bind ACLs ---", ...groups];
  }

  generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
    objects: NormalizedObject[] = [],
  ): RollbackCommand {
    const ctx = new GenContext(objects, zoneMappings);
    const { acl } = this.aclFor(rule, ctx);
    const ace = this.translateRule(rule, ctx).config.split("\n")[1];
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `no ${ace}`,
      explanation: `Remove the migrated ACE for "${rule.name}" from ${acl}`,
    };
  }
}
