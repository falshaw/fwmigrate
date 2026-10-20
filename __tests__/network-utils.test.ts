import { describe, it, expect } from "vitest";
import {
  ipToBigInt,
  cidrToRange,
  parseAddressToRanges,
  rangesOverlap,
  rangeContains,
  compareAddresses,
  parseServiceToPorts,
  compareServices,
  calculateOverlapPercentage,
} from "../src/lib/analysis/NetworkUtils";

describe("fwmigrate NetworkUtils - ipToBigInt", () => {
  it("should convert 0.0.0.0 to 0n", () => {
    expect(ipToBigInt("0.0.0.0")).toBe(0n);
  });

  it("should convert 255.255.255.255 to max uint32", () => {
    expect(ipToBigInt("255.255.255.255")).toBe((1n << 32n) - 1n);
  });

  it("should convert 10.0.0.1 correctly", () => {
    // 10*2^24 + 0 + 0 + 1 = 167772161
    expect(ipToBigInt("10.0.0.1")).toBe(167772161n);
  });

  it("should return 0n for 'any'", () => {
    expect(ipToBigInt("any")).toBe(0n);
  });

  it("should return -1n for invalid IP", () => {
    expect(ipToBigInt("999.0.0.1")).toBe(-1n);
    expect(ipToBigInt("not-an-ip")).toBe(-1n);
  });

  it("should handle CIDR notation by extracting the IP part", () => {
    expect(ipToBigInt("192.168.1.0/24")).toBe(ipToBigInt("192.168.1.0"));
  });
});

describe("fwmigrate NetworkUtils - cidrToRange", () => {
  it("should handle 'any' as full range", () => {
    const range = cidrToRange("any");
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0n);
    expect(range!.end).toBe((1n << 32n) - 1n);
  });

  it("should handle single IP (no mask) as /32", () => {
    const range = cidrToRange("10.0.0.1");
    expect(range).not.toBeNull();
    expect(range!.start).toBe(range!.end);
  });

  it("should parse /24 CIDR correctly", () => {
    const range = cidrToRange("192.168.1.0/24");
    expect(range).not.toBeNull();
    // 192.168.1.0 to 192.168.1.255 = 256 addresses
    expect(range!.end - range!.start + 1n).toBe(256n);
  });

  it("should return null for invalid CIDR", () => {
    expect(cidrToRange("invalid")).toBeNull();
  });

  it("should return null for mask > 32", () => {
    expect(cidrToRange("10.0.0.0/33")).toBeNull();
  });
});

describe("fwmigrate NetworkUtils - rangesOverlap", () => {
  it("should detect overlapping ranges", () => {
    expect(
      rangesOverlap({ start: 0n, end: 10n }, { start: 5n, end: 15n }),
    ).toBe(true);
  });

  it("should detect non-overlapping ranges", () => {
    expect(
      rangesOverlap({ start: 0n, end: 5n }, { start: 10n, end: 20n }),
    ).toBe(false);
  });

  it("should detect adjacent ranges as non-overlapping", () => {
    expect(rangesOverlap({ start: 0n, end: 4n }, { start: 5n, end: 10n })).toBe(
      false,
    );
  });
});

describe("fwmigrate NetworkUtils - compareAddresses", () => {
  it("should detect 'any' contains a specific subnet", () => {
    expect(compareAddresses("any", "10.0.0.0/24")).toBe("contains");
  });

  it("should detect a subnet is contained by a larger one", () => {
    expect(compareAddresses("10.0.0.0/24", "10.0.0.0/16")).toBe("contained");
  });

  it("should detect no overlap between disjoint subnets", () => {
    expect(compareAddresses("10.0.0.0/24", "192.168.0.0/24")).toBe("none");
  });
});

describe("fwmigrate NetworkUtils - parseServiceToPorts", () => {
  it("should treat 'any' as full port range", () => {
    const ports = parseServiceToPorts("any");
    expect(ports.length).toBe(1);
    expect(ports[0].start).toBe(0);
    expect(ports[0].end).toBe(65535);
  });

  it("should parse a single port number", () => {
    const ports = parseServiceToPorts("443");
    expect(ports.length).toBe(1);
    expect(ports[0].start).toBe(443);
    expect(ports[0].end).toBe(443);
  });

  it("should parse a port range", () => {
    const ports = parseServiceToPorts("8000-8080");
    expect(ports.length).toBe(1);
    expect(ports[0].start).toBe(8000);
    expect(ports[0].end).toBe(8080);
  });

  it("should parse protocol-prefixed port", () => {
    const ports = parseServiceToPorts("tcp/443");
    expect(ports.length).toBe(1);
    expect(ports[0].start).toBe(443);
    expect(ports[0].protocol).toBe("tcp");
  });
});

describe("fwmigrate NetworkUtils - compareServices", () => {
  it("should detect 'any' contains a specific port", () => {
    expect(compareServices("any", "443")).toBe("contains");
  });

  it("should detect equal single ports as overlapping", () => {
    expect(compareServices("80", "80")).toBe("overlaps");
  });

  it("should detect no overlap for disjoint ports", () => {
    expect(compareServices("80", "443")).toBe("none");
  });
});

describe("fwmigrate NetworkUtils - calculateOverlapPercentage", () => {
  it("should return 100 for identical ranges", () => {
    expect(calculateOverlapPercentage("10.0.0.0/24", "10.0.0.0/24")).toBe(100);
  });

  it("should return 0 for disjoint ranges", () => {
    expect(calculateOverlapPercentage("10.0.0.0/24", "192.168.0.0/24")).toBe(0);
  });
});
