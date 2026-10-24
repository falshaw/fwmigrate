/**
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

// Record<FirewallVendor, …> makes the compiler reject a supported vendor
// without a generator.
const generators: Record<FirewallVendor, new () => IConfigGenerator> = {
  PALO_ALTO: PaloAltoGenerator,
  CISCO_ASA: CiscoASAGenerator,
  CHECKPOINT: CheckPointGenerator,
  FORTINET: FortinetGenerator,
  JUNIPER_SRX: JuniperSRXGenerator,
};

export function getGenerator(vendor: FirewallVendor): IConfigGenerator {
  const GeneratorClass = generators[vendor];
  if (!GeneratorClass)
    throw new Error(`No generator available for vendor: ${vendor}`);
  return new GeneratorClass();
}
