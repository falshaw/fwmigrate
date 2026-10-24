/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Normalized types for cross-vendor rule representation
 */

import type { FirewallVendor } from "../vendors";
export type { FirewallVendor };

export interface NormalizedRule {
  name: string;
  position: number;
  enabled: boolean;
  action: "permit" | "deny" | "drop";
  sources: string[]; // IP addresses/CIDRs/object names
  destinations: string[]; // IP addresses/CIDRs/object names
  services: string[]; // "tcp/80", "udp/53", service names
  sourceZone?: string;
  destinationZone?: string;
  description?: string;
  logging: boolean;
  rawVendorData?: Record<string, unknown>;
}

export interface NormalizedObject {
  objectType: "address" | "address-group" | "service" | "service-group";
  name: string;
  members: string[];
  rawVendorData?: Record<string, unknown>;
}

export interface NormalizedNATRule {
  position: number;
  natType: "source" | "destination" | "static" | "dynamic-pat";
  originalSource: string[];
  translatedSource: string[];
  originalDest: string[];
  translatedDest: string[];
  service?: string[];
  rawVendorData?: Record<string, unknown>;
}

export interface NormalizedInterface {
  name: string;
  ip?: string;
  mask?: string;
  zone?: string;
  vlan?: number;
  enabled: boolean;
}

export interface NormalizedRoute {
  destination: string;
  nextHop: string;
  interface?: string;
  metric?: number;
}

export interface ParseLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  line?: number;
  context?: string;
}

export interface ParseResult {
  rules: NormalizedRule[];
  objects: NormalizedObject[];
  natRules: NormalizedNATRule[];
  interfaces: NormalizedInterface[];
  routes: NormalizedRoute[];
  parseLog: ParseLogEntry[];
  confidence: number; // 0-1
  warnings: string[];
}

export interface ValidationResult {
  valid: boolean;
  vendor?: FirewallVendor;
  configType?: "xml" | "text" | "json" | "set";
  errors: string[];
  lineCount: number;
}
