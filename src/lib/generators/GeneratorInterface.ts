/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type {
  FirewallVendor,
  NormalizedRule,
  NormalizedObject,
} from "../parsers/types";

export interface ZoneMapping {
  sourceZone: string;
  targetZone: string;
}

export interface RuleConfig {
  position: number;
  ruleName: string;
  config: string;
  explanation: string;
  warnings: string[];
}

export interface GeneratorResult {
  config: string;
  ruleConfigs: RuleConfig[];
  warnings: string[];
  objectsCreated: string[];
}

export interface RollbackCommand {
  position: number;
  ruleName: string;
  command: string;
  explanation: string;
}

export interface IConfigGenerator {
  vendor: FirewallVendor;
  generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
  ): Promise<GeneratorResult>;
  generateRule(rule: NormalizedRule, zoneMappings: ZoneMapping[]): string;
  generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
  ): RollbackCommand;
}
