/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Single source of truth for the supported vendors.
 *
 * A vendor is listed here only when it has a parser, a generator and tests
 * for both (tests/parsers/*, tests/generators/*). The API validators, the
 * Prisma enum, the parser/generator factories and every UI list derive from
 * this file — do not hard-code vendor lists anywhere else.
 */

export const SUPPORTED_VENDORS = [
  "PALO_ALTO",
  "CISCO_ASA",
  "CHECKPOINT",
  "FORTINET",
  "JUNIPER_SRX",
] as const;

export type FirewallVendor = (typeof SUPPORTED_VENDORS)[number];

export interface VendorInfo {
  id: FirewallVendor;
  label: string;
  /** Source format the parser accepts */
  sourceFormat: string;
  /** Output format the generator emits */
  targetFormat: string;
}

export const VENDORS: Record<FirewallVendor, VendorInfo> = {
  PALO_ALTO: {
    id: "PALO_ALTO",
    label: "Palo Alto Networks (PAN-OS)",
    sourceFormat: "XML config export or set commands",
    targetFormat: "set commands",
  },
  CISCO_ASA: {
    id: "CISCO_ASA",
    label: "Cisco ASA",
    sourceFormat: "show running-config",
    targetFormat: "CLI (objects, ACLs, access-group)",
  },
  CHECKPOINT: {
    id: "CHECKPOINT",
    label: "Check Point (R80+)",
    sourceFormat: "Management API JSON (show access-rulebase)",
    targetFormat: "mgmt_cli commands",
  },
  FORTINET: {
    id: "FORTINET",
    label: "Fortinet FortiGate (FortiOS)",
    sourceFormat: "FortiOS CLI config",
    targetFormat: "FortiOS CLI config",
  },
  JUNIPER_SRX: {
    id: "JUNIPER_SRX",
    label: "Juniper SRX (Junos)",
    sourceFormat: "set commands",
    targetFormat: "set commands",
  },
};

export const VENDOR_LIST: VendorInfo[] = SUPPORTED_VENDORS.map(
  (v) => VENDORS[v],
);

export const VENDOR_COUNT = SUPPORTED_VENDORS.length;

/** Short label, e.g. "Palo Alto Networks" for compact UI places. */
export function vendorLabel(vendor: string): string {
  return (VENDORS as Record<string, VendorInfo>)[vendor]?.label ?? vendor;
}

export function isSupportedVendor(v: string): v is FirewallVendor {
  return (SUPPORTED_VENDORS as readonly string[]).includes(v);
}
