/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Check Point R80+ Management API generator (mgmt_cli script).
 */

import type { RollbackCommand, ZoneMapping } from "./GeneratorInterface";
import type { FirewallVendor, NormalizedRule } from "../parsers/types";
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
import { predefinedNames, type ResolvedService, type ServiceSpec } from "./services";

const LAYER = "Network";
const S = "-s id.txt";
// Rules are inserted in order just above the layer's default cleanup rule
const CLEANUP_RULE = "Cleanup rule";

export class CheckPointGenerator extends BaseGenerator {
  vendor: FirewallVendor = "CHECKPOINT";
  commentPrefix = "#";
  protected targetLabel = "a Check Point access rule";

  /** dns-domain objects are referenced by their domain name, not the source name */
  private cpName(name: string, ctx: GenContext): string {
    const a = ctx.addresses.get(name);
    return a?.ref.kind === "fqdn" ? `.${a.ref.fqdn}` : name;
  }

  protected translateRule(rule: NormalizedRule, ctx: GenContext): RuleTranslation {
    const facts = analyseRule(rule, ctx, this.vendor);
    const warnings = [...facts.warnings];
    const unknown: string[] = [];
    let extraPenalty = 0;

    const addrs = (tokens: string[]) => {
      const names = tokens.map((t) => ctx.useAddress(t, unknown));
      return names.includes(null) || names.length === 0
        ? ["Any"]
        : [...new Set((names as string[]).map((n) => this.cpName(n, ctx)))];
    };
    const src = addrs(rule.sources);
    const dst = addrs(rule.destinations);

    let services: string[];
    if (facts.services.any || facts.forceDisable) services = ["Any"];
    else services = [...new Set(facts.services.services.flatMap((s) => this.serviceNames(s, ctx)))];

    const fromZone = ctx.mapZone(rule.sourceZone);
    const toZone = ctx.mapZone(rule.destinationZone);
    if (fromZone || toZone) {
      warnings.push(
        `REVIEW: zones ${fromZone ?? "any"} -> ${toZone ?? "any"} are not part of a Check Point access rule; enforce them with security-zone objects or the gateway topology.`,
      );
      extraPenalty += 0.05;
    }

    const list = (field: string, xs: string[]) => xs.map((x, i) => `${field}.${i + 1} ${quote(x)}`);
    const comments = [
      rule.description,
      facts.services.applications.length ? `Source App-ID: ${facts.services.applications.join(", ")}` : "",
      disableReason(facts, unknown),
    ]
      .filter(Boolean)
      .join(" | ");

    const parts = [
      `mgmt_cli add access-rule layer ${quote(LAYER)} position.above ${quote(CLEANUP_RULE)}`,
      `name ${quote(rule.name)}`,
      ...list("source", src),
      ...list("destination", dst),
      ...list("service", services),
      `action ${quote(rule.action === "permit" ? "Accept" : "Drop")}`,
      `track.type ${quote(rule.logging ? "Log" : "None")}`,
    ];
    if (!rule.enabled || disableReason(facts, unknown)) parts.push(`enabled false`);
    if (comments) parts.push(`comments ${quote(comments.slice(0, 1000))}`);
    parts.push(S);

    warnings.push(...unknownAddressWarning(unknown));
    return {
      config: parts.join(" \\\n  "),
      warnings,
      confidence: confidenceFrom(facts, extraPenalty, new Set(unknown).size),
      explanation: describeRule(rule, facts, this.targetLabel),
    };
  }

  private serviceNames(s: ResolvedService, ctx: GenContext): string[] {
    if (s.origin !== "object") {
      const pre = predefinedNames(s.key, "checkpoint");
      if (pre) return pre;
    }
    const base = s.label.replace(/_/g, "-");
    if (s.specs.length === 1) {
      if (!ctx.customServices.has(base)) ctx.customServices.set(base, s);
      return [base];
    }
    // One Check Point service object per protocol/port
    return s.specs.map((spec) => {
      const name = `${base}-${spec.proto}${spec.ports ? `-${spec.ports}` : ""}`;
      if (!ctx.customServices.has(name)) ctx.customServices.set(name, { ...s, specs: [spec] });
      return name;
    });
  }

  private serviceCommand(name: string, spec: ServiceSpec): string {
    if (spec.proto === "icmp")
      return `mgmt_cli add service-icmp name ${quote(name)}${spec.icmpType !== undefined ? ` icmp-type ${spec.icmpType}` : ""} ${S}`;
    return `mgmt_cli add service-${spec.proto} name ${quote(name)} port ${quote(spec.ports!)} ${S}`;
  }

  protected renderObjects(ctx: GenContext): string[] {
    const out: string[] = [
      "# Log in first:  mgmt_cli login -u <admin-user> > id.txt",
      `# Rules go into layer "${LAYER}" above "${CLEANUP_RULE}"; adjust both names to your policy package.`,
    ];
    for (const a of ctx.addresses.values()) {
      switch (a.ref.kind) {
        case "host":
          out.push(`mgmt_cli add host name ${quote(a.name)} ip-address ${quote(a.ref.ip)} ${S}`);
          break;
        case "subnet":
          out.push(`mgmt_cli add network name ${quote(a.name)} subnet ${quote(a.ref.ip)} mask-length ${a.ref.prefix} ${S}`);
          break;
        case "range":
          out.push(
            `mgmt_cli add address-range name ${quote(a.name)} ip-address-first ${quote(a.ref.start)} ip-address-last ${quote(a.ref.end)} ${S}`,
          );
          break;
        case "fqdn":
          out.push(`mgmt_cli add dns-domain name ${quote(`.${a.ref.fqdn}`)} is-sub-domain false ${S}`);
          break;
      }
    }
    for (const g of ctx.groups.values()) {
      const members = g.members.map((m, i) => `members.${i + 1} ${quote(this.cpName(m, ctx))}`).join(" ");
      out.push(`mgmt_cli add group name ${quote(g.name)} ${members} ${S}`);
    }
    for (const [name, s] of ctx.customServices) out.push(this.serviceCommand(name, s.specs[0]));
    return out;
  }

  protected wrapRules(blocks: string[]): string[] {
    return [...blocks, "", `mgmt_cli publish ${S}`, `mgmt_cli logout ${S}`];
  }

  generateRollback(rule: NormalizedRule, _zoneMappings: ZoneMapping[]): RollbackCommand {
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `mgmt_cli delete access-rule layer ${quote(LAYER)} name ${quote(rule.name)} ${S}`,
      explanation: `Remove migrated rule "${rule.name}" from the ${LAYER} layer (publish afterwards)`,
    };
  }
}
