/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Junos (SRX) set-command generator: global address book, custom
 * applications and zone-pair (or global) security policies.
 */

import type {
  GenerateOptions,
  GeneratorResult,
  RollbackCommand,
  ZoneMapping,
} from "./GeneratorInterface";
import type { FirewallVendor, NormalizedObject, NormalizedRule } from "../parsers/types";
import {
  BaseGenerator,
  GenContext,
  analyseRule,
  confidenceFrom,
  disableReason,
  describeRule,
  quote,
  unknownAddressWarning,
  type RuleTranslation,
} from "./base";
import { predefinedNames, type ResolvedService } from "./services";

function junosName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 63);
}

export class JuniperSRXGenerator extends BaseGenerator {
  vendor: FirewallVendor = "JUNIPER_SRX";
  commentPrefix = "#";
  protected targetLabel = "a Junos security policy";

  private policyPrefix(rule: NormalizedRule, ctx: GenContext): { prefix: string; global: boolean; from: string; to: string } {
    const from = ctx.mapZone(rule.sourceZone);
    const to = ctx.mapZone(rule.destinationZone);
    const name = junosName(rule.name);
    if (from && to)
      return { prefix: `set security policies from-zone ${from} to-zone ${to} policy ${name}`, global: false, from, to };
    return { prefix: `set security policies global policy ${name}`, global: true, from: from ?? "any", to: to ?? "any" };
  }

  /**
   * The SRX evaluates every zone policy before any global policy. A global
   * policy that sat above a zone-specific rule in the source loses that
   * precedence on the target, so it is flagged.
   */
  async generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
    options: GenerateOptions = {},
  ): Promise<GeneratorResult> {
    const out = await super.generate(rules, objects, zoneMappings, options);
    const ctx = new GenContext(objects, zoneMappings);
    const live = out.ruleConfigs.map((rc) => !/^deactivate /m.test(rc.config));
    const global = rules.map((r) => this.policyPrefix(r, ctx).global);
    out.ruleConfigs.forEach((rc, i) => {
      if (!global[i] || !live[i]) return;
      const later = rules.filter((_, j) => j > i && !global[j] && live[j]).map((r) => r.name);
      if (!later.length) return;
      const names = later.slice(0, 3).join(", ") + (later.length > 3 ? ` and ${later.length - 3} more` : "");
      rc.warnings.push(
        `REVIEW: the SRX evaluates global policies after all zone policies, but this rule comes before ${later.length} zone-specific rule${later.length === 1 ? "" : "s"} (${names}) in the source; traffic both match now hits the zone policy first — check the order.`,
      );
      rc.confidence = Math.max(0.1, Math.round((rc.confidence - 0.25) * 100) / 100);
    });
    return out;
  }

  protected translateRule(rule: NormalizedRule, ctx: GenContext): RuleTranslation {
    const facts = analyseRule(rule, ctx, this.vendor);
    const warnings = [...facts.warnings];
    const unknown: string[] = [];
    const { prefix: p, global, from, to } = this.policyPrefix(rule, ctx);
    if (global) warnings.push("Source or destination zone is any: emitted as a global policy.");

    const addrs = (tokens: string[]) => {
      const names = tokens.map((t) => ctx.useAddress(t, unknown));
      return names.includes(null) || names.length === 0 ? ["any"] : [...new Set(names as string[])];
    };

    let apps: string[];
    if (facts.services.any || facts.forceDisable) apps = ["any"];
    else apps = [...new Set(facts.services.services.flatMap((s) => this.appNames(s, ctx)))];

    const lines: string[] = [];
    if (global) {
      lines.push(`${p} match from-zone ${from}`);
      lines.push(`${p} match to-zone ${to}`);
    }
    for (const a of addrs(rule.sources)) lines.push(`${p} match source-address ${a}`);
    for (const a of addrs(rule.destinations)) lines.push(`${p} match destination-address ${a}`);
    for (const a of apps) lines.push(`${p} match application ${a}`);
    const permit = rule.action === "permit";
    lines.push(`${p} then ${permit ? "permit" : "deny"}`);
    if (rule.logging) lines.push(`${p} then log ${permit ? "session-close" : "session-init"}`);
    const desc = [
      rule.description,
      facts.services.applications.length ? `Source App-ID: ${facts.services.applications.join(", ")}` : "",
      disableReason(facts, unknown, "deactivated"),
    ]
      .filter(Boolean)
      .join(" | ");
    if (desc) lines.push(`${p} description ${quote(desc.slice(0, 900))}`);
    if (!rule.enabled || disableReason(facts, unknown)) lines.push(p.replace(/^set /, "deactivate "));

    warnings.push(...unknownAddressWarning(unknown));
    return {
      config: lines.join("\n"),
      warnings,
      confidence: confidenceFrom(facts, 0, new Set(unknown).size),
      explanation: describeRule(rule, facts, this.targetLabel),
    };
  }

  private appNames(s: ResolvedService, ctx: GenContext): string[] {
    if (s.origin === "predefined") return [s.label];
    if (s.origin !== "object") {
      const pre = predefinedNames(s.key, "junos");
      if (pre) return pre;
    }
    const name = junosName(s.label.replace(/_/g, "-"));
    if (!ctx.customServices.has(name)) ctx.customServices.set(name, s);
    return [name];
  }

  protected renderObjects(ctx: GenContext): string[] {
    const out: string[] = [];
    const ab = "set security address-book global";
    for (const a of ctx.addresses.values()) {
      switch (a.ref.kind) {
        case "host":
          out.push(`${ab} address ${a.name} ${a.ref.ip}/32`);
          break;
        case "subnet":
          out.push(`${ab} address ${a.name} ${a.ref.ip}/${a.ref.prefix}`);
          break;
        case "range":
          out.push(`${ab} address ${a.name} range-address ${a.ref.start} to ${a.ref.end}`);
          break;
        case "fqdn":
          out.push(`${ab} address ${a.name} dns-name ${a.ref.fqdn}`);
          break;
      }
    }
    for (const g of ctx.groups.values()) {
      for (const m of g.members)
        out.push(`${ab} address-set ${g.name} ${ctx.groups.has(m) ? "address-set" : "address"} ${m}`);
    }
    for (const [name, s] of ctx.customServices) {
      const app = `set applications application ${name}`;
      const body = (x: (typeof s.specs)[number]) =>
        x.proto === "icmp"
          ? `protocol icmp${x.icmpType !== undefined ? ` icmp-type ${x.icmpType}` : ""}`
          : `protocol ${x.proto} destination-port ${x.ports}`;
      if (s.specs.length === 1) {
        const x = s.specs[0];
        if (x.proto === "icmp") {
          out.push(`${app} protocol icmp`);
          if (x.icmpType !== undefined) out.push(`${app} icmp-type ${x.icmpType}`);
        } else {
          out.push(`${app} protocol ${x.proto}`);
          out.push(`${app} destination-port ${x.ports}`);
        }
      } else {
        s.specs.forEach((x, i) => out.push(`${app} term t${i + 1} ${body(x)}`));
      }
    }
    return out;
  }

  generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
    objects: NormalizedObject[] = [],
  ): RollbackCommand {
    const { prefix } = this.policyPrefix(rule, new GenContext(objects, zoneMappings));
    return {
      position: rule.position,
      ruleName: rule.name,
      command: prefix.replace(/^set /, "delete "),
      explanation: `Remove migrated policy "${junosName(rule.name)}"`,
    };
  }
}
