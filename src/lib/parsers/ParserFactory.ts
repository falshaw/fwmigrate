/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type { FirewallVendor } from "./types";
import type { IConfigParser } from "./ParserInterface";
import { CiscoASAParser } from "./CiscoASAParser";
import { FortinetParser } from "./FortinetParser";
import { PaloAltoParser } from "./PaloAltoParser";
import { JuniperSRXParser } from "./JuniperSRXParser";
import { CheckPointParser } from "./CheckPointParser";
import { SophosParser } from "./SophosParser";
import { SonicWallParser } from "./SonicWallParser";
import { WatchGuardParser } from "./WatchGuardParser";
import { PfSenseParser } from "./PfSenseParser";
import { MikroTikParser } from "./MikroTikParser";

const parsers: Record<string, new () => IConfigParser> = {
  CISCO_ASA: CiscoASAParser,
  CISCO_FTD: CiscoASAParser,
  FORTINET: FortinetParser,
  PALO_ALTO: PaloAltoParser,
  JUNIPER_SRX: JuniperSRXParser,
  CHECKPOINT: CheckPointParser,
  SOPHOS: SophosParser,
  SONICWALL: SonicWallParser,
  WATCHGUARD: WatchGuardParser,
  PFSENSE: PfSenseParser,
  MIKROTIK: MikroTikParser,
};

export function getParser(vendor: FirewallVendor): IConfigParser {
  const ParserClass = parsers[vendor];
  if (!ParserClass)
    throw new Error(`No parser available for vendor: ${vendor}`);
  return new ParserClass();
}

export function getSupportedVendors(): FirewallVendor[] {
  return Object.keys(parsers) as FirewallVendor[];
}
