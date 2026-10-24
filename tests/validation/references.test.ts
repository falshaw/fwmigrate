/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * The validator reports what a device would reject (undefined references) and
 * no longer floods normal block syntax with "duplicate line" or text-level
 * shadow warnings.
 */

import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/lib/validation/ConfigValidator";

const FORTIOS_OK = `config firewall address
    edit "web1"
        set subnet 192.0.2.10 255.255.255.255
    next
    edit "web2"
        set subnet 192.0.2.11 255.255.255.255
    next
end
config firewall policy
    edit 0
        set name "a"
        set srcintf "port1"
        set dstintf "port2"
        set srcaddr "all"
        set dstaddr "web1"
        set action accept
        set schedule "always"
        set service "HTTPS"
    next
    edit 0
        set name "b"
        set srcintf "port1"
        set dstintf "port2"
        set srcaddr "all"
        set dstaddr "web2"
        set action accept
        set schedule "always"
        set service "HTTPS"
        set status disable
    next
end
`;

describe("FortiOS", () => {
  it("passes a correct config with no warnings at all", () => {
    const r = validateConfig(FORTIOS_OK, "FORTINET");
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("errors on an undefined address and an unknown service", () => {
    const bad = FORTIOS_OK.replace('set dstaddr "web1"', 'set dstaddr "does-not-exist"').replace(
      'set service "HTTPS"',
      'set service "NO-SUCH-SVC"',
    );
    const r = validateConfig(bad, "FORTINET");
    expect(r.valid).toBe(false);
    expect(r.issues.filter((i) => i.severity === "error").map((i) => i.message)).toEqual([
      "Undefined reference: address does-not-exist",
      "Undefined reference: service NO-SUCH-SVC",
    ]);
  });

  it("accepts the FortiGate built-ins all, ALL_TCP and service groups", () => {
    const cfg = `config firewall service group
    edit "web-svcs"
        set member "HTTP" "HTTPS"
    next
end
config firewall policy
    edit 0
        set name "c"
        set srcintf "port1"
        set dstintf "port2"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "web-svcs" "ALL_TCP"
    next
end
`;
    expect(validateConfig(cfg, "FORTINET").issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("Junos", () => {
  it("errors on an undefined address but accepts any junos-* application", () => {
    const cfg = [
      "set security address-book global address web 192.0.2.10/32",
      "set security policies from-zone a to-zone b policy p match source-address any",
      "set security policies from-zone a to-zone b policy p match destination-address nope",
      "set security policies from-zone a to-zone b policy p match application junos-pgsql",
      "set security policies from-zone a to-zone b policy p then permit",
    ].join("\n");
    const errs = validateConfig(cfg, "JUNIPER_SRX").issues.filter((i) => i.severity === "error");
    expect(errs.map((e) => e.message)).toEqual(["Undefined reference: address nope"]);
  });
});

describe("Cisco ASA", () => {
  it("warns (does not error) on an access list that no access-group applies", () => {
    const cfg = [
      "object network web",
      " host 192.0.2.10",
      "access-list dmz_in extended permit tcp any object web eq 443",
    ].join("\n");
    const r = validateConfig(cfg, "CISCO_ASA");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.severity === "warning" && /Not applied: access-group for dmz_in/.test(i.message))).toBe(true);
  });
});
