/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * PAN-OS set-command generator.
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
import { SERVICE_CATALOG, type ResolvedService } from "./services";

const NAME_MAX = 63;

export class PaloAltoGenerator extends BaseGenerator {
  vendor: FirewallVendor = "PALO_ALTO";
  commentPrefix = "#";
  protected targetLabel = "a PAN-OS security rule";

  protected translateRule(rule: NormalizedRule, ctx: GenContext): RuleTranslation {
    const facts = analyseRule(rule, ctx, this.vendor);
    const warnings = [...facts.warnings];
    const unknown: string[] = [];
    let extraPenalty = 0;

    const name = this.sanitizeName(rule.name);
    if (name !== rule.name) warnings.push(`Rule name normalised to "${name}" (PAN-OS naming rules).`);

    const from = ctx.mapZone(rule.sourceZone) ?? "any";
    const to = ctx.mapZone(rule.destinationZone) ?? "any";

    const addrs = (tokens: string[]) => {
      const names = tokens.map((t) => ctx.useAddress(t, unknown));
      return names.includes(null) || names.length === 0
        ? ["any"]
        : [...new Set(names as string[])];
    };
    const source = addrs(rule.sources);
    const destination = addrs(rule.destinations);

    let applications = ["any"];
    let services: string[];
    const srcApps = facts.services.applications;

    if (facts.forceDisable) {
      services = ["any"];
    } else if (srcApps.length) {
      // PAN-OS source: keep App-ID as is
      applications = srcApps;
      services = facts.services.fromApplicationDefault
        ? ["application-default"]
        : facts.services.any
          ? ["any"]
          : facts.services.services.flatMap((s) => this.serviceNames(s, ctx));
    } else if (facts.services.any) {
      services = ["any"];
    } else {
      const icmp = facts.services.services.filter((s) => s.specs.every((x) => x.proto === "icmp"));
      const ports = facts.services.services.filter((s) => !s.specs.every((x) => x.proto === "icmp"));
      if (icmp.length && !ports.length) {
        // PAN-OS has no ICMP service objects: ICMP is matched by App-ID
        applications = [...new Set(icmp.map((s) => (s.specs.some((x) => x.icmpType === 8) && s.specs.length === 1 ? "ping" : "icmp")))];
        services = ["application-default"];
        warnings.push(`ICMP translated to App-ID ${applications.join(", ")} with application-default.`);
      } else {
        if (icmp.length) {
          warnings.push(
            "REVIEW: rule mixes ICMP with TCP/UDP; PAN-OS matches ICMP by App-ID — add a separate rule for ICMP (ping/icmp).",
          );
          extraPenalty += 0.15;
        }
        services = [...new Set(ports.flatMap((s) => this.serviceNames(s, ctx)))];
      }
    }

    const action = rule.action === "permit" ? "allow" : rule.action === "drop" ? "drop" : "deny";
    const r = `set rulebase security rules ${quote(name)}`;
    const list = (xs: string[]) => `[ ${xs.map(quote).join(" ")} ]`;
    const lines = [
      `${r} from ${list([from])}`,
      `${r} to ${list([to])}`,
      `${r} source ${list(source)}`,
      `${r} destination ${list(destination)}`,
      `${r} application ${list(applications)}`,
      `${r} service ${list(services)}`,
      `${r} action ${action}`,
      `${r} log-end ${rule.logging ? "yes" : "no"}`,
    ];
    const desc = [rule.description, disableReason(facts, unknown)]
      .filter(Boolean)
      .join(" | ");
    if (desc) lines.push(`${r} description ${quote(desc.slice(0, 1023))}`);
    if (!rule.enabled || disableReason(facts, unknown)) lines.push(`${r} disabled yes`);

    warnings.push(...unknownAddressWarning(unknown));
    return {
      config: lines.join("\n"),
      warnings,
      confidence: confidenceFrom(facts, extraPenalty, new Set(unknown).size),
      explanation: describeRule(rule, facts, this.targetLabel),
    };
  }

  /** PAN-OS service objects carry one protocol; tcp+udp services become two objects. */
  private serviceNames(s: ResolvedService, ctx: GenContext): string[] {
    if (s.key && s.origin !== "object") {
      const predefined = SERVICE_CATALOG[s.key]?.names.panos;
      if (predefined) return [predefined];
    }
    const portSpecs = s.specs.filter((x) => x.proto !== "icmp");
    const protos = [...new Set(portSpecs.map((x) => x.proto))];
    const base = this.sanitizeName(s.label.replace(/_/g, "-"));
    return protos.map((proto) => {
      const name = protos.length > 1 ? `${base}-${proto}` : base;
      if (!ctx.customServices.has(name))
        ctx.customServices.set(name, { ...s, specs: portSpecs.filter((x) => x.proto === proto) });
      return name;
    });
  }

  protected renderObjects(ctx: GenContext): string[] {
    const out: string[] = [];
    for (const a of ctx.addresses.values()) {
      const n = `set address ${quote(a.name)}`;
      switch (a.ref.kind) {
        case "host":
          out.push(`${n} ip-netmask ${a.ref.ip}/32`);
          break;
        case "subnet":
          out.push(`${n} ip-netmask ${a.ref.ip}/${a.ref.prefix}`);
          break;
        case "range":
          out.push(`${n} ip-range ${a.ref.start}-${a.ref.end}`);
          break;
        case "fqdn":
          out.push(`${n} fqdn ${a.ref.fqdn}`);
          break;
      }
    }
    for (const g of ctx.groups.values()) {
      out.push(`set address-group ${quote(g.name)} static [ ${g.members.map(quote).join(" ")} ]`);
    }
    for (const [name, s] of ctx.customServices) {
      const proto = s.specs[0]?.proto;
      const ports = s.specs.map((x) => x.ports).join(",");
      out.push(`set service ${quote(name)} protocol ${proto} port ${ports}`);
    }
    return out;
  }

  generateRollback(rule: NormalizedRule, _zoneMappings: ZoneMapping[]): RollbackCommand {
    const name = this.sanitizeName(rule.name);
    return {
      position: rule.position,
      ruleName: rule.name,
      command: `delete rulebase security rules ${quote(name)}`,
      explanation: `Remove migrated rule "${name}" from the PAN-OS security rulebase`,
    };
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.\- ]/g, "_").slice(0, NAME_MAX);
  }
}
