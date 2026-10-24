/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * FortiOS CLI generator (config firewall address / addrgrp / service custom /
 * policy).
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
  prefixToMask,
  quote,
  unknownAddressWarning,
  type RuleTranslation,
} from "./base";
import { SERVICE_CATALOG, type ResolvedService } from "./services";

const NAME_MAX = 35; // FortiOS policy name length limit
const COMMENT_MAX = 1023;

export class FortinetGenerator extends BaseGenerator {
  vendor: FirewallVendor = "FORTINET";
  commentPrefix = "#";
  protected targetLabel = "a FortiOS firewall policy";

  protected translateRule(rule: NormalizedRule, ctx: GenContext): RuleTranslation {
    const facts = analyseRule(rule, ctx, this.vendor);
    const warnings = [...facts.warnings];
    const unknown: string[] = [];
    let extraPenalty = 0;

    const srcintf = ctx.mapZone(rule.sourceZone) ?? "any";
    const dstintf = ctx.mapZone(rule.destinationZone) ?? "any";

    const addrs = (tokens: string[]) => {
      const names = tokens.map((t) => ctx.useAddress(t, unknown));
      return names.includes(null) || names.length === 0
        ? ["all"]
        : [...new Set(names as string[])];
    };
    const srcaddr = addrs(rule.sources);
    const dstaddr = addrs(rule.destinations);

    let services: string[];
    if (facts.services.any || facts.forceDisable) {
      services = ["ALL"];
    } else {
      services = facts.services.services.flatMap((s) => this.serviceNames(s, ctx));
      services = [...new Set(services)];
    }

    let name = rule.name;
    if (name.length > NAME_MAX) {
      name = name.slice(0, NAME_MAX);
      warnings.push(`Policy name shortened to ${NAME_MAX} characters (FortiOS limit).`);
      extraPenalty += 0.02;
    }

    const commentParts: string[] = [];
    if (rule.description) commentParts.push(rule.description);
    if (facts.services.applications.length)
      commentParts.push(`Source App-ID: ${facts.services.applications.join(", ")}`);
    const disabledBy = disableReason(facts, unknown);
    if (disabledBy) commentParts.push(disabledBy);
    const comment = commentParts.join(" | ").slice(0, COMMENT_MAX);

    const lines: string[] = [];
    // edit 0: FortiOS assigns the next free policy ID. Writing the source
    // position (edit 1, 2, ...) would overwrite existing policies on the box.
    lines.push("    edit 0");
    lines.push(`        set name ${quote(name)}`);
    lines.push(`        set srcintf ${quote(srcintf)}`);
    lines.push(`        set dstintf ${quote(dstintf)}`);
    lines.push(`        set srcaddr ${srcaddr.map(quote).join(" ")}`);
    lines.push(`        set dstaddr ${dstaddr.map(quote).join(" ")}`);
    lines.push(`        set action ${rule.action === "permit" ? "accept" : "deny"}`);
    lines.push(`        set schedule "always"`);
    lines.push(`        set service ${services.map(quote).join(" ")}`);
    lines.push(`        set logtraffic ${rule.logging ? "all" : "disable"}`);
    if (!rule.enabled || disabledBy) lines.push(`        set status disable`);
    if (comment) lines.push(`        set comments ${quote(comment)}`);
    lines.push("    next");

    warnings.push(...unknownAddressWarning(unknown));
    return {
      config: lines.join("\n"),
      warnings,
      confidence: confidenceFrom(facts, extraPenalty, new Set(unknown).size),
      explanation: describeRule(rule, facts, this.targetLabel),
    };
  }

  private serviceNames(s: ResolvedService, ctx: GenContext): string[] {
    if (s.key && s.origin !== "object") {
      const predefined = SERVICE_CATALOG[s.key]?.names.fortinet;
      if (predefined) return [predefined];
    }
    const name = s.label.replace(/_/g, "-");
    const icmp = s.specs.filter((x) => x.proto === "icmp");
    const ports = s.specs.filter((x) => x.proto !== "icmp");
    // A FortiOS custom service is either TCP/UDP or ICMP, never both
    if (icmp.length && ports.length) {
      const a = { ...s, specs: ports };
      const b = { ...s, specs: icmp };
      ctx.customServices.set(name, a);
      ctx.customServices.set(`${name}-icmp`, b);
      return [name, `${name}-icmp`];
    }
    if (!ctx.customServices.has(name)) ctx.customServices.set(name, s);
    return [name];
  }

  protected wrapRules(blocks: string[]): string[] {
    return ["config firewall policy", ...blocks, "end"];
  }

  protected renderObjects(ctx: GenContext): string[] {
    const out: string[] = [];
    if (ctx.addresses.size) {
      out.push("config firewall address");
      for (const a of ctx.addresses.values()) {
        out.push(`    edit ${quote(a.name)}`);
        switch (a.ref.kind) {
          case "host":
            out.push(`        set subnet ${a.ref.ip} 255.255.255.255`);
            break;
          case "subnet":
            out.push(`        set subnet ${a.ref.ip} ${prefixToMask(a.ref.prefix)}`);
            break;
          case "range":
            out.push(`        set type iprange`);
            out.push(`        set start-ip ${a.ref.start}`);
            out.push(`        set end-ip ${a.ref.end}`);
            break;
          case "fqdn":
            out.push(`        set type fqdn`);
            out.push(`        set fqdn ${quote(a.ref.fqdn)}`);
            break;
        }
        out.push("    next");
      }
      out.push("end");
    }
    if (ctx.groups.size) {
      out.push("config firewall addrgrp");
      for (const g of ctx.groups.values()) {
        out.push(`    edit ${quote(g.name)}`);
        out.push(`        set member ${g.members.map(quote).join(" ")}`);
        out.push("    next");
      }
      out.push("end");
    }
    if (ctx.customServices.size) {
      out.push("config firewall service custom");
      for (const [name, s] of ctx.customServices) {
        out.push(`    edit ${quote(name)}`);
        const icmp = s.specs.filter((x) => x.proto === "icmp");
        if (icmp.length && icmp.length === s.specs.length) {
          out.push(`        set protocol ICMP`);
          if (icmp[0].icmpType !== undefined) out.push(`        set icmptype ${icmp[0].icmpType}`);
        } else {
          const tcp = s.specs.filter((x) => x.proto === "tcp").map((x) => x.ports);
          const udp = s.specs.filter((x) => x.proto === "udp").map((x) => x.ports);
          if (tcp.length) out.push(`        set tcp-portrange ${tcp.join(" ")}`);
          if (udp.length) out.push(`        set udp-portrange ${udp.join(" ")}`);
        }
        out.push("    next");
      }
      out.push("end");
    }
    return out;
  }

  generateRollback(rule: NormalizedRule, _zoneMappings: ZoneMapping[]): RollbackCommand {
    return {
      position: rule.position,
      ruleName: rule.name,
      // The import used "edit 0", so FortiOS chose the ID: look it up by the
      // policy name (unique per VDOM), then delete that ID.
      command: [
        `show firewall policy | grep -f ${quote(rule.name)}`,
        "config firewall policy",
        "    delete <id shown by the command above>",
        "end",
      ].join("\n"),
      explanation: `Find the ID FortiOS gave policy "${rule.name}", then delete that policy`,
    };
  }
}
