/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type { FirewallVendor, ParseResult, ValidationResult } from "./types";

export interface IConfigParser {
  vendor: FirewallVendor;
  parse(rawConfig: string): Promise<ParseResult>;
  validate(rawConfig: string): ValidationResult;
}
