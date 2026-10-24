/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Network Utilities for IP/CIDR analysis
 */

export interface IPRange {
  start: bigint;
  end: bigint;
}
export interface PortRange {
  start: number;
  end: number;
  protocol?: string;
}

export function ipToBigInt(ip: string): bigint {
  if (ip === "any" || ip === "0.0.0.0/0") return 0n;
  const ipPart = ip.split("/")[0];
  const parts = ipPart.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255))
    return -1n;
  return (
    (BigInt(parts[0]) << 24n) +
    (BigInt(parts[1]) << 16n) +
    (BigInt(parts[2]) << 8n) +
    BigInt(parts[3])
  );
}

export function cidrToRange(cidr: string): IPRange | null {
  if (cidr === "any" || cidr === "0.0.0.0/0")
    return { start: 0n, end: (1n << 32n) - 1n };
  if (!cidr.includes("/")) {
    const ip = ipToBigInt(cidr);
    if (ip === -1n) return null;
    return { start: ip, end: ip };
  }
  const [ipPart, maskStr] = cidr.split("/");
  const mask = parseInt(maskStr, 10);
  if (isNaN(mask) || mask < 0 || mask > 32) return null;
  const ip = ipToBigInt(ipPart);
  if (ip === -1n) return null;
  const maskBits = mask === 0 ? 0n : ((1n << 32n) - 1n) << BigInt(32 - mask);
  const start = ip & maskBits;
  const end = start | ((1n << BigInt(32 - mask)) - 1n);
  return { start, end };
}

export function parseAddressToRanges(address: string): IPRange[] {
  if (!address || address === "any")
    return [{ start: 0n, end: (1n << 32n) - 1n }];
  const ranges: IPRange[] = [];
  for (const part of address.split(",").map((s) => s.trim())) {
    if (part.includes("-") && !part.includes("/")) {
      const [startIp, endIp] = part.split("-");
      const start = ipToBigInt(startIp.trim());
      const end = ipToBigInt(endIp.trim());
      if (start !== -1n && end !== -1n) ranges.push({ start, end });
    } else {
      const range = cidrToRange(part);
      if (range) ranges.push(range);
    }
  }
  return ranges;
}

export function rangesOverlap(a: IPRange, b: IPRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}
export function rangeContains(container: IPRange, contained: IPRange): boolean {
  return container.start <= contained.start && container.end >= contained.end;
}

export function compareAddresses(
  addrA: string,
  addrB: string,
): "contains" | "contained" | "overlaps" | "none" {
  const rangesA = parseAddressToRanges(addrA);
  const rangesB = parseAddressToRanges(addrB);
  if (rangesA.length === 0 || rangesB.length === 0) return "none";

  let aContainsB = true;
  for (const rb of rangesB) {
    if (!rangesA.some((ra) => rangeContains(ra, rb))) {
      aContainsB = false;
      break;
    }
  }
  let bContainsA = true;
  for (const ra of rangesA) {
    if (!rangesB.some((rb) => rangeContains(rb, ra))) {
      bContainsA = false;
      break;
    }
  }

  if (aContainsB && bContainsA) return "overlaps";
  if (aContainsB) return "contains";
  if (bContainsA) return "contained";

  for (const ra of rangesA) {
    for (const rb of rangesB) {
      if (rangesOverlap(ra, rb)) return "overlaps";
    }
  }
  return "none";
}

export function parseServiceToPorts(service: string): PortRange[] {
  if (!service || service === "any" || service === "application-default")
    return [{ start: 0, end: 65535 }];
  const ranges: PortRange[] = [];
  for (const part of service.split(",").map((s) => s.trim())) {
    const match = part.match(/^(tcp|udp|icmp)?[\/:]?(\d+)(?:-(\d+))?$/i);
    if (match) {
      ranges.push({
        start: parseInt(match[2]),
        end: match[3] ? parseInt(match[3]) : parseInt(match[2]),
        protocol: match[1]?.toLowerCase(),
      });
    }
  }
  return ranges.length > 0 ? ranges : [{ start: 0, end: 65535 }];
}

export function compareServices(
  svcA: string,
  svcB: string,
): "contains" | "contained" | "overlaps" | "none" {
  const portsA = parseServiceToPorts(svcA);
  const portsB = parseServiceToPorts(svcB);

  const portContains = (c: PortRange, t: PortRange) => {
    if (c.protocol && t.protocol && c.protocol !== t.protocol) return false;
    return c.start <= t.start && c.end >= t.end;
  };

  const aContainsB = portsB.every((pb) =>
    portsA.some((pa) => portContains(pa, pb)),
  );
  const bContainsA = portsA.every((pa) =>
    portsB.some((pb) => portContains(pb, pa)),
  );

  if (aContainsB && bContainsA) return "overlaps";
  if (aContainsB) return "contains";
  if (bContainsA) return "contained";

  for (const pa of portsA) {
    for (const pb of portsB) {
      if (
        (!pa.protocol || !pb.protocol || pa.protocol === pb.protocol) &&
        pa.start <= pb.end &&
        pb.start <= pa.end
      )
        return "overlaps";
    }
  }
  return "none";
}

export function calculateOverlapPercentage(
  addrA: string,
  addrB: string,
): number {
  const rangesA = parseAddressToRanges(addrA);
  const rangesB = parseAddressToRanges(addrB);
  if (rangesA.length === 0 || rangesB.length === 0) return 0;
  let overlapSize = 0n;
  let totalSizeB = 0n;
  for (const rb of rangesB) {
    totalSizeB += rb.end - rb.start + 1n;
    for (const ra of rangesA) {
      if (rangesOverlap(ra, rb)) {
        const overlapStart = ra.start > rb.start ? ra.start : rb.start;
        const overlapEnd = ra.end < rb.end ? ra.end : rb.end;
        overlapSize += overlapEnd - overlapStart + 1n;
      }
    }
  }
  if (totalSizeB === 0n) return 0;
  return Number((overlapSize * 100n) / totalSizeB);
}
