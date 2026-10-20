/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type { FirewallVendor } from "./types";
import type { IConfigParser } from "./ParserInterface";
import { SUPPORTED_VENDORS } from "../vendors";
import { CiscoASAParser } from "./CiscoASAParser";
import { FortinetParser } from "./FortinetParser";
import { PaloAltoParser } from "./PaloAltoParser";
import { JuniperSRXParser } from "./JuniperSRXParser";
import { CheckPointParser } from "./CheckPointParser";

// Record<FirewallVendor, …> makes the compiler reject a supported vendor
// without a parser.
const parsers: Record<FirewallVendor, new () => IConfigParser> = {
  PALO_ALTO: PaloAltoParser,
  CISCO_ASA: CiscoASAParser,
  CHECKPOINT: CheckPointParser,
  FORTINET: FortinetParser,
  JUNIPER_SRX: JuniperSRXParser,
};

export function getParser(vendor: FirewallVendor): IConfigParser {
  const ParserClass = parsers[vendor];
  if (!ParserClass)
    throw new Error(`No parser available for vendor: ${vendor}`);
  return new ParserClass();
}

export function getSupportedVendors(): FirewallVendor[] {
  return [...SUPPORTED_VENDORS];
}
