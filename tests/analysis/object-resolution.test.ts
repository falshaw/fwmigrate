/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Rule analysis with object resolution: address objects, nested groups,
 * service objects/groups and App-IDs are resolved before the checks run.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { analyzeRuleset, type RuleIssue } from "../../src/lib/analysis/RuleAnalysisEngine";
import {
  ObjectIndex,
  addressCovers,
  resolveAddresses,
  resolveRuleServices,
  serviceCovers,
} from "../../src/lib/analysis/ObjectResolver";
import { getParser } from "../../src/lib/parsers/ParserFactory";
import type { FirewallVendor, NormalizedObject, NormalizedRule } from "../../src/lib/parsers/types";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

async function analyzeFixture(vendor: FirewallVendor, file: string) {
  const parsed = await getParser(vendor).parse(fixture(file));
  return { parsed, analysis: analyzeRuleset(parsed.rules, parsed.objects) };
}

const find = (issues: RuleIssue[], type: string, position: number) =>
  issues.filter((i) => i.type === type && i.rulePosition === position);

const obj = (
  objectType: NormalizedObject["objectType"],
  name: string,
  members: string[],
): NormalizedObject => ({ objectType, name, members });

const rule = (o: Partial<NormalizedRule> & { position: number; name: string }): NormalizedRule => ({
  enabled: true,
  action: "permit",
  sources: ["any"],
  destinations: ["any"],
  services: ["any"],
  logging: false,
  ...o,
});

describe("ObjectResolver", () => {
  const index = new ObjectIndex([
    obj("address", "web-01", ["203.0.113.10/32"]),
    obj("address", "web-02", ["203.0.113.11/32"]),
    obj("address", "pool", ["10.10.10.1-10.10.10.254"]),
    obj("address", "lan", ["192.0.2.0 255.255.255.0"]),
    obj("address", "cdn", ["cdn.example.com"]),
    obj("address-group", "web", ["web-01", "web-02"]),
    obj("address-group", "web-alias", ["web"]),
    obj("address-group", "loop-a", ["loop-b", "web-01"]),
    obj("address-group", "loop-b", ["loop-a", "web-02"]),
    obj("service", "tcp-443", ["tcp/443"]),
    obj("service", "tcp-8080", ["tcp/8080"]),
    obj("service-group", "web-ports", ["tcp-443", "tcp-8080"]),
  ]);

  it("resolves nested address groups to the member addresses", () => {
    const set = resolveAddresses(["web-alias"], index);
    expect(set.unresolved).toEqual([]);
    expect(set.ranges).toHaveLength(1); // .10 and .11 merge into one range
    expect(addressCovers(set, resolveAddresses(["203.0.113.11"], index))).toBe(true);
    expect(addressCovers(set, resolveAddresses(["203.0.113.12"], index))).toBe(false);
  });

  it("survives group loops", () => {
    const set = resolveAddresses(["loop-a"], index);
    expect(set.unresolved).toEqual([]);
    expect(addressCovers(set, resolveAddresses(["web"], index))).toBe(true);
  });

  it("reads ranges, address+mask, FQDN objects and is case-insensitive", () => {
    expect(addressCovers(resolveAddresses(["POOL"], index), resolveAddresses(["10.10.10.50"], index))).toBe(true);
    expect(addressCovers(resolveAddresses(["lan"], index), resolveAddresses(["192.0.2.0/25"], index))).toBe(true);
    const cdn = resolveAddresses(["cdn"], index);
    expect(cdn.fqdns.has("cdn.example.com")).toBe(true);
    expect(cdn.unresolved).toEqual([]);
  });

  it("reports names that are not defined", () => {
    expect(resolveAddresses(["nms-poller"], index).unresolved).toEqual(["nms-poller"]);
  });

  it("treats 0.0.0.0/0 as any", () => {
    expect(resolveAddresses(["0.0.0.0/0"], index).any).toBe(true);
  });

  it("resolves service groups and App-IDs", () => {
    const group = resolveRuleServices(rule({ position: 1, name: "a", services: ["web-ports"] }), index);
    const one = resolveRuleServices(rule({ position: 2, name: "b", services: ["tcp-8080"] }), index);
    expect(serviceCovers(group, one)).toBe(true);
    expect(serviceCovers(one, group)).toBe(false);

    const app = resolveRuleServices(
      rule({
        position: 3,
        name: "c",
        services: ["application-default"],
        rawVendorData: { application: ["ssl"] },
      }),
      index,
    );
    expect(app.tcp).toEqual([{ start: 443, end: 443 }]);
    expect(app.apps).toEqual(new Set(["ssl"]));
    // App-ID narrows the rule: a port-only rule on 443 covers it, not the other way round
    const port443 = resolveRuleServices(rule({ position: 4, name: "d", services: ["tcp-443"] }), index);
    expect(serviceCovers(port443, app)).toBe(true);
    expect(serviceCovers(app, port443)).toBe(false);
  });
});

describe("analysis needs object resolution (legacy PAN-OS rule base)", () => {
  it("finds the shadowed, duplicate, conflicting and overlapping rules", async () => {
    const { analysis } = await analyzeFixture("PALO_ALTO", "paloalto-legacy-ruleset.xml");
    const { issues, summary } = analysis;

    // Shadowed through a nested group + App-ID, a service group, and a temporary any rule
    expect(find(issues, "shadow", 2)[0]?.relatedRulePosition).toBe(1);
    expect(find(issues, "shadow", 4)[0]?.relatedRulePosition).toBe(3);
    expect(find(issues, "shadow", 15)[0]?.relatedRulePosition).toBe(14);
    expect(summary.shadows).toBe(3);

    // A deny below an allow that already matches it
    const conflict = find(issues, "conflict", 5)[0];
    expect(conflict?.relatedRulePosition).toBe(3);
    expect(conflict?.severity).toBe("critical");

    // Same traffic under two group names (web-farm = web-servers)
    expect(find(issues, "redundant", 7)[0]?.description).toContain("duplicate");
    // A later, broader admin rule makes the SSH rule redundant
    expect(find(issues, "redundant", 8)[0]?.relatedRulePosition).toBe(9);
    expect(summary.redundant).toBe(2);

    // Opposite actions on partly shared traffic
    expect(find(issues, "overlap", 12).map((i) => i.relatedRulePosition).sort()).toEqual([11, 3].sort());

    expect(find(issues, "permissive", 14)[0]?.severity).toBe("critical");
    expect(find(issues, "permissive", 13)[0]?.severity).toBe("low");
    expect(find(issues, "disabled", 16)).toHaveLength(1);
    expect(find(issues, "unresolved", 17)[0]?.description).toContain("nms-poller");
  });

  it("misses every group-based finding when the objects are not resolved", async () => {
    const parsed = await getParser("PALO_ALTO").parse(fixture("paloalto-legacy-ruleset.xml"));
    const blind = analyzeRuleset(parsed.rules, []);
    // Only the shadow behind the literal any/any/any rule needs no objects
    expect(blind.issues.filter((i) => i.type === "shadow").map((i) => i.rulePosition)).toEqual([15]);
    expect(blind.summary.conflicts + blind.summary.redundant).toBe(0);
  });

  it("does not call an explicit deny redundant because a final deny-all exists", async () => {
    const { analysis } = await analyzeFixture("PALO_ALTO", "paloalto-legacy-ruleset.xml");
    expect(find(analysis.issues, "redundant", 10)).toHaveLength(0);
    expect(find(analysis.issues, "redundant", 12)).toHaveLength(0);
  });

  it("orders findings by severity", async () => {
    const { analysis } = await analyzeFixture("PALO_ALTO", "paloalto-legacy-ruleset.xml");
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const ranks = analysis.issues.map((i) => rank[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("analysis on the other vendor fixtures", () => {
  it("Check Point: an allow below the DMZ-to-LAN drop never matches", async () => {
    const { analysis } = await analyzeFixture("CHECKPOINT", "checkpoint-export.json");
    const c = find(analysis.issues, "conflict", 11)[0];
    expect(c?.relatedRuleName).toBe("Deny-DMZ-to-LAN");
  });

  it("FortiOS: the backup SSH rule is shadowed through the MGMT-HOSTS group", async () => {
    const { analysis } = await analyzeFixture("FORTINET", "fortinet-config.txt");
    expect(find(analysis.issues, "shadow", 13)[0]?.relatedRuleName).toBe("MGMT-to-DMZ");
    expect(analysis.summary.unresolved).toBe(0); // SMTPS / IMAPS are predefined FortiOS services
  });

  it("PAN-OS sample: syslog from the DMZ is blocked by the earlier DMZ-to-LAN deny", async () => {
    const { analysis } = await analyzeFixture("PALO_ALTO", "paloalto-config.xml");
    expect(find(analysis.issues, "overlap", 10)[0]?.relatedRuleName).toBe("Deny-DMZ-to-LAN");
  });

  it("Cisco ASA: rules in different access lists are not compared", async () => {
    const { analysis } = await analyzeFixture("CISCO_ASA", "cisco-asa-show-run.txt");
    // OUTSIDE_IN ends with "deny ip any any"; the INSIDE_OUT permits after it are a different ACL
    expect(analysis.summary.conflicts).toBe(0);
    expect(analysis.summary.shadows).toBe(0);
  });

  it("Cisco ASA: rules inside one access list are compared", () => {
    const acl = { aclName: "OUTSIDE_IN" };
    const result = analyzeRuleset([
      rule({ position: 1, name: "deny-all", action: "deny", rawVendorData: acl }),
      rule({ position: 2, name: "permit-web", sources: ["any"], destinations: ["203.0.113.10"], services: ["tcp/443"], rawVendorData: acl }),
    ]);
    expect(find(result.issues, "conflict", 2)).toHaveLength(1);
  });
});
