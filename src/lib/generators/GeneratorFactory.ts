/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type { FirewallVendor } from "../parsers/types";
import type { IConfigGenerator } from "./GeneratorInterface";
import { PaloAltoGenerator } from "./PaloAltoGenerator";
import { CiscoASAGenerator } from "./CiscoASAGenerator";
import { FortinetGenerator } from "./FortinetGenerator";
import { CheckPointGenerator } from "./CheckPointGenerator";
import { JuniperSRXGenerator } from "./JuniperSRXGenerator";
import { SophosGenerator } from "./SophosGenerator";
import { SonicWallGenerator } from "./SonicWallGenerator";
import { WatchGuardGenerator } from "./WatchGuardGenerator";
import { PfSenseGenerator } from "./PfSenseGenerator";
import { MikroTikGenerator } from "./MikroTikGenerator";

const generators: Record<string, new () => IConfigGenerator> = {
  PALO_ALTO: PaloAltoGenerator,
  CISCO_ASA: CiscoASAGenerator,
  CISCO_FTD: CiscoASAGenerator,
  FORTINET: FortinetGenerator,
  CHECKPOINT: CheckPointGenerator,
  JUNIPER_SRX: JuniperSRXGenerator,
  SOPHOS: SophosGenerator,
  SONICWALL: SonicWallGenerator,
  WATCHGUARD: WatchGuardGenerator,
  PFSENSE: PfSenseGenerator,
  MIKROTIK: MikroTikGenerator,
};

export function getGenerator(vendor: FirewallVendor): IConfigGenerator {
  const GeneratorClass = generators[vendor];
  if (!GeneratorClass)
    throw new Error(`No generator available for vendor: ${vendor}`);
  return new GeneratorClass();
}
