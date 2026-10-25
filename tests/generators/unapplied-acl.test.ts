/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * A Cisco ASA access list without access-group filters no transit traffic.
 * Its rules must never become live policies on the target.
 */

import { describe, it, expect } from "vitest";
import { CiscoASAParser } from "../../src/lib/parsers/CiscoASAParser";
import { getGenerator } from "../../src/lib/generators/GeneratorFactory";
import { analyzeRuleset } from "../../src/lib/analysis/RuleAnalysisEngine";
import { SUPPORTED_VENDORS } from "../../src/lib/vendors";
import { REFERENCE_CHECKS, fixture } from "./helpers";

const CONFIG = `: Saved
ASA Version 9.16(4)
hostname fw1
interface GigabitEthernet0/0
 nameif outside
 security-level 0
 ip address 198.51.100.1 255.255.255.0
interface GigabitEthernet0/1
 nameif inside
 security-level 100
 ip address 192.0.2.1 255.255.255.0
access-list OUTSIDE_IN extended permit tcp any host 203.0.113.10 eq https
access-list OUTSIDE_IN extended deny ip any any
access-list EGRESS extended deny tcp any any eq smtp
access-list GLOBAL_ACL extended permit icmp any any
access-list MGMT_ACL extended permit tcp host 192.0.2.100 any eq ssh
access-group OUTSIDE_IN in interface outside
access-group EGRESS out interface outside
access-group GLOBAL_ACL global
: end
`;

const DISABLED = /status disable|disabled yes|inactive|^deactivate |enabled false/m;

async function parse() {
  return new CiscoASAParser().parse(CONFIG);
}

describe("ASA parser: access-group bindings", () => {
  it("marks only the rules of the ACL no access-group applies", async () => {
    const { rules, parseLog } = await parse();
    const marked = rules.filter((r) => r.rawVendorData?.notApplied).map((r) => r.name);
    expect(marked).toEqual(["MGMT_ACL-5"]);
    expect(parseLog.some((l) => l.level === "warn" && l.message.includes("MGMT_ACL is not applied"))).toBe(true);
  });

  it("takes the ingress zone from 'in interface' and the egress zone from 'out interface'", async () => {
    const { rules } = await parse();
    const byName = Object.fromEntries(rules.map((r) => [r.name, r]));
    expect(byName["OUTSIDE_IN-1"].sourceZone).toBe("outside");
    expect(byName["EGRESS-3"].sourceZone).toBeUndefined();
    expect(byName["EGRESS-3"].destinationZone).toBe("outside");
    expect(byName["GLOBAL_ACL-4"].rawVendorData?.notApplied).toBeUndefined();
  });

  it("marks every rule when the config has no access-group at all", async () => {
    const { rules } = await new CiscoASAParser().parse(CONFIG.replace(/^access-group .*\n/gm, ""));
    expect(rules.every((r) => r.rawVendorData?.notApplied === true)).toBe(true);
  });

  it("the demo fixture leaves only MGMT_ACL unapplied", async () => {
    const { rules } = await new CiscoASAParser().parse(fixture("CISCO_ASA"));
    const acls = new Set(rules.filter((r) => r.rawVendorData?.notApplied).map((r) => r.rawVendorData?.aclName));
    expect([...acls]).toEqual(["MGMT_ACL"]);
  });
});

describe.each(SUPPORTED_VENDORS.map((v) => [v]))("unapplied ACL -> %s", (target) => {
  it("is emitted disabled with a REVIEW flag and low confidence; applied rules stay live", async () => {
    const { rules, objects } = await parse();
    const out = await getGenerator(target).generate(rules, objects, []);
    for (const rc of out.ruleConfigs) {
      if (rc.ruleName === "MGMT_ACL-5") {
        expect(rc.config).toMatch(DISABLED);
        expect(rc.confidence).toBe(0.3);
        expect(rc.warnings.some((w) => w.startsWith("REVIEW: access list MGMT_ACL is not applied"))).toBe(true);
      } else {
        expect(rc.config, rc.ruleName).not.toMatch(DISABLED);
        expect(rc.warnings.some((w) => w.includes("is not applied"))).toBe(false);
      }
    }
    expect(REFERENCE_CHECKS[target](out.config)).toEqual([]);
  });
});

describe("ASA target", () => {
  it("does not bind the unapplied ACL", async () => {
    const { rules, objects } = await parse();
    const out = await getGenerator("CISCO_ASA").generate(rules, objects, []);
    expect(out.config).toMatch(/^access-group OUTSIDE_IN in interface outside$/m);
    expect(out.config).not.toMatch(/^access-group MGMT_ACL/m);
  });
});

describe("analysis", () => {
  it("reports the unapplied rule and leaves it out of the rule comparisons", async () => {
    const { rules, objects } = await parse();
    const { issues, summary } = analyzeRuleset(rules, objects);
    const unapplied = issues.filter((i) => i.type === "unapplied");
    expect(unapplied.map((i) => [i.ruleName, i.severity])).toEqual([["MGMT_ACL-5", "high"]]);
    expect(summary.unapplied).toBe(1);
    expect(issues.some((i) => i.ruleName === "MGMT_ACL-5" && i.type !== "unapplied")).toBe(false);
  });
});
