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
  /** Review flags; entries starting with "REVIEW:" need an engineer's decision */
  warnings: string[];
  /** 0-1, deterministic: lowered for every unresolved or lossy element */
  confidence: number;
}

export interface GenerateOptions {
  /** Replace the generated block of these rule positions (manual overrides) */
  overrides?: Record<number, string>;
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
  /** Line comment prefix in the target syntax ("#" or "!") */
  commentPrefix: string;
  /**
   * Full target config: the objects the rules reference (source objects and
   * objects created for literal addresses/services), then the rules.
   */
  generate(
    rules: NormalizedRule[],
    objects: NormalizedObject[],
    zoneMappings: ZoneMapping[],
    options?: GenerateOptions,
  ): Promise<GeneratorResult>;
  generateRule(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
    objects?: NormalizedObject[],
  ): string;
  generateRollback(
    rule: NormalizedRule,
    zoneMappings: ZoneMapping[],
    objects?: NormalizedObject[],
  ): RollbackCommand;
}
