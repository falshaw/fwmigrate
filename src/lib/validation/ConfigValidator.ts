/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * FM-04: Config Validation Engine
 * Validates translated firewall configurations for syntax correctness.
 */

import type { FirewallVendor } from "../parsers/types";

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  line?: number;
  rule?: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  vendor: string;
  totalChecks: number;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

// Common IP validation regex
const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\/(?:3[0-2]|[12]?\d))?$/;
const IPV6_REGEX = /^(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}(?:\/\d{1,3})?$/;
const PORT_RANGE_REGEX = /^\d{1,5}(?:-\d{1,5})?$/;

function isValidIP(value: string): boolean {
  if (value === "any" || value === "0.0.0.0/0") return true;
  return IPV4_REGEX.test(value) || IPV6_REGEX.test(value);
}

function isValidPort(value: string): boolean {
  if (!PORT_RANGE_REGEX.test(value)) return false;
  const parts = value.split("-");
  return parts.every((p) => {
    const num = parseInt(p, 10);
    return num >= 0 && num <= 65535;
  });
}

// ============================================================================
// Vendor-Specific Validators
// ============================================================================

function validatePaloAlto(config: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = config.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("!") || line.startsWith("#")) continue;

    const lineNum = i + 1;

    // Check 'set' command structure
    if (line.startsWith("set ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: `Incomplete 'set' command: "${line}"`,
          suggestion: "Ensure command has at least: set <path> <value>",
        });
      }

      // Check for unclosed quotes
      const quoteCount = (line.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: "Unclosed double quote",
          suggestion: "Ensure all double quotes are paired",
        });
      }
    }

    // Check for common PAN-OS required sections
    if (line.includes("rulebase security rules")) {
      if (
        !line.includes("from") &&
        !line.includes("to") &&
        !line.includes("action")
      ) {
        // This is just the rule name declaration, which is fine
      }
    }

    // IP format validation in address objects
    if (line.includes("ip-netmask")) {
      const ipMatch = line.match(/ip-netmask\s+(\S+)/);
      if (ipMatch && !isValidIP(ipMatch[1])) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: `Invalid IP/CIDR format: ${ipMatch[1]}`,
          suggestion: "Use format: x.x.x.x or x.x.x.x/y",
        });
      }
    }
  }

  // Check for action in rules
  if (
    config.includes("rulebase security rules") &&
    !config.includes("action")
  ) {
    issues.push({
      severity: "warning",
      message: "No action specified in security rule — will default to deny",
      suggestion: "Explicitly set action: allow, deny, drop, or reset",
    });
  }

  return issues;
}

function validateCiscoASA(config: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = config.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("!")) continue;

    const lineNum = i + 1;

    // access-list validation
    if (line.startsWith("access-list")) {
      const parts = line.split(/\s+/);
      if (parts.length < 5) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: "Incomplete access-list entry",
          suggestion:
            "Format: access-list <name> extended permit|deny <protocol> <src> <dst>",
        });
        continue;
      }

      // Check for valid action
      const actionIdx = parts.indexOf("extended") + 1;
      if (actionIdx > 0 && actionIdx < parts.length) {
        const action = parts[actionIdx];
        if (!["permit", "deny"].includes(action)) {
          issues.push({
            severity: "error",
            line: lineNum,
            message: `Invalid action "${action}" — must be permit or deny`,
            suggestion: 'Use "permit" or "deny"',
          });
        }
      }

      // Check for valid protocol
      const validProtocols = [
        "ip",
        "tcp",
        "udp",
        "icmp",
        "esp",
        "ahp",
        "gre",
        "object-group",
      ];
      const protocolIdx = parts.indexOf("extended") + 2;
      if (
        protocolIdx > 1 &&
        protocolIdx < parts.length &&
        !validProtocols.includes(parts[protocolIdx])
      ) {
        issues.push({
          severity: "warning",
          line: lineNum,
          message: `Uncommon protocol "${parts[protocolIdx]}"`,
          suggestion: `Common protocols: ${validProtocols.join(", ")}`,
        });
      }
    }

    // object-group validation
    if (line.startsWith("object-group")) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: "Object-group missing type or name",
          suggestion: "Format: object-group network|service|protocol <name>",
        });
      }
    }

    // NAT statement validation
    if (line.startsWith("nat")) {
      if (!line.includes("(") || !line.includes(")")) {
        issues.push({
          severity: "warning",
          line: lineNum,
          message: "NAT statement may be missing interface specification",
          suggestion: "Format: nat (inside,outside) ...",
        });
      }
    }
  }

  return issues;
}

function validateFortinet(config: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = config.split("\n");
  const blockStack: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const lineNum = i + 1;

    // Track config/edit/next/end blocks
    if (line.startsWith("config ") || line.startsWith("edit ")) {
      blockStack.push(line);
    } else if (line === "end" || line === "next") {
      if (blockStack.length === 0) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: `Unexpected "${line}" without matching config/edit block`,
          suggestion: "Ensure all config blocks have matching end/next",
        });
      } else {
        blockStack.pop();
      }
    }

    // set command validation
    if (line.startsWith("set ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: `Incomplete 'set' command: "${line}"`,
          suggestion: "Format: set <parameter> <value>",
        });
      }

      // Port range validation
      if (
        parts[1] === "dstport" ||
        parts[1] === "srcport" ||
        parts[1] === "port"
      ) {
        const portVal = parts.slice(2).join(" ");
        if (portVal && !isValidPort(portVal.replace(/\s+/g, ""))) {
          issues.push({
            severity: "warning",
            line: lineNum,
            message: `Potentially invalid port specification: ${portVal}`,
            suggestion: "Use format: <port> or <start>-<end> (0-65535)",
          });
        }
      }
    }

    // Check for required fields in firewall policy
    if (line === "config firewall policy") {
      // Look ahead for required fields in policy entries
      let hasAction = false;
      let hasSrcintf = false;
      let hasDstintf = false;
      for (let j = i + 1; j < lines.length && j < i + 30; j++) {
        const ahead = lines[j].trim();
        if (ahead === "end") break;
        if (ahead.startsWith("set action")) hasAction = true;
        if (ahead.startsWith("set srcintf")) hasSrcintf = true;
        if (ahead.startsWith("set dstintf")) hasDstintf = true;
      }
      if (!hasAction) {
        issues.push({
          severity: "warning",
          line: lineNum,
          message: "Firewall policy missing 'set action' — defaults to deny",
          suggestion: "Add 'set action accept' or 'set action deny'",
        });
      }
      if (!hasSrcintf || !hasDstintf) {
        issues.push({
          severity: "warning",
          line: lineNum,
          message: "Firewall policy missing source or destination interface",
          suggestion: "Add 'set srcintf' and 'set dstintf'",
        });
      }
    }
  }

  // Check for unclosed blocks
  if (blockStack.length > 0) {
    issues.push({
      severity: "error",
      message: `${blockStack.length} unclosed config block(s)`,
      suggestion: "Ensure every 'config'/'edit' has a matching 'end'/'next'",
    });
  }

  return issues;
}

function validateCheckPoint(config: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = config.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const lineNum = i + 1;

    // mgmt_cli command validation
    if (line.startsWith("mgmt_cli")) {
      if (
        !line.includes("add") &&
        !line.includes("set") &&
        !line.includes("delete")
      ) {
        issues.push({
          severity: "warning",
          line: lineNum,
          message: "mgmt_cli command missing action verb",
          suggestion: "Use: mgmt_cli add|set|delete ...",
        });
      }

      // Check for required name parameter in rule commands
      if (
        (line.includes("access-rule") || line.includes("access-section")) &&
        !line.includes("name")
      ) {
        issues.push({
          severity: "warning",
          line: lineNum,
          message: "Access rule missing 'name' parameter",
          suggestion: 'Add name "rule-name" to the command',
        });
      }

      // Check for layer specification
      if (line.includes("access-rule") && !line.includes("layer")) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: "Access rule missing 'layer' parameter",
          suggestion: 'Add layer "Network" (or appropriate layer name)',
        });
      }
    }
  }

  return issues;
}

function validateJuniperSRX(config: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = config.split("\n");
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#") || line.startsWith("/*")) continue;

    const lineNum = i + 1;

    // Check set command syntax
    if (line.startsWith("set ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: `Incomplete 'set' command: "${line}"`,
          suggestion: "Format: set <hierarchy> <value>",
        });
      }

      // Security policy requires from-zone/to-zone
      if (
        line.includes("security policies") &&
        !line.includes("from-zone") &&
        !line.includes("global")
      ) {
        issues.push({
          severity: "warning",
          line: lineNum,
          message: "Security policy should specify from-zone and to-zone",
          suggestion:
            "Format: set security policies from-zone <zone> to-zone <zone> policy <name>",
        });
      }
    }

    // Brace matching for hierarchical config
    if (!line.startsWith("set ") && !line.startsWith("delete ")) {
      const opens = (line.match(/{/g) || []).length;
      const closes = (line.match(/}/g) || []).length;
      braceDepth += opens - closes;

      if (braceDepth < 0) {
        issues.push({
          severity: "error",
          line: lineNum,
          message: "Unmatched closing brace",
          suggestion: "Check brace pairing in hierarchical config",
        });
        braceDepth = 0;
      }
    }
  }

  if (braceDepth > 0) {
    issues.push({
      severity: "error",
      message: `${braceDepth} unclosed brace(s) in hierarchical config`,
      suggestion: "Ensure all opening braces have matching closing braces",
    });
  }

  return issues;
}

function validateGeneric(config: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = config.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lineNum = i + 1;

    // Check for common IP format issues
    const ipMatches = line.match(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?\b/g,
    );
    if (ipMatches) {
      for (const ip of ipMatches) {
        if (!isValidIP(ip)) {
          issues.push({
            severity: "error",
            line: lineNum,
            message: `Invalid IP address: ${ip}`,
            suggestion: "Ensure each octet is 0-255 and CIDR prefix is 0-32",
          });
        }
      }
    }

    // Check for empty rule names
    if (line.match(/name\s+""\s/) || line.match(/name\s+''\s/)) {
      issues.push({
        severity: "warning",
        line: lineNum,
        message: "Empty rule name detected",
        suggestion: "Provide a descriptive name for the rule",
      });
    }
  }

  // Check for duplicate lines (potential duplicate rules)
  const nonEmptyLines = lines.filter(
    (l) => l.trim() && !l.trim().startsWith("!"),
  );
  const seen = new Set<string>();
  for (const line of nonEmptyLines) {
    if (seen.has(line.trim())) {
      issues.push({
        severity: "warning",
        message: `Duplicate config line: "${line.trim().substring(0, 80)}..."`,
        suggestion: "Check for unintentionally duplicated rules",
      });
    }
    seen.add(line.trim());
  }

  return issues;
}

// ============================================================================
// Cross-Rule Validation: Shadowed Rules Detection
// ============================================================================

interface ExtractedRule {
  line: number;
  name: string;
  action: string;
  sources: string[];
  destinations: string[];
  services: string[];
}

function extractRulesFromConfig(
  config: string,
  vendor: string,
): ExtractedRule[] {
  const rules: ExtractedRule[] = [];
  const lines = config.split("\n");

  if (vendor === "CISCO_ASA" || vendor === "CISCO_FTD") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("access-list") && line.includes("extended")) {
        const parts = line.split(/\s+/);
        const actionIdx = parts.indexOf("extended") + 1;
        if (actionIdx > 0 && actionIdx < parts.length) {
          const action = parts[actionIdx];
          // Simplified extraction: protocol src dst
          const remaining = parts.slice(actionIdx + 1);
          rules.push({
            line: i + 1,
            name: parts[1] || `line-${i + 1}`,
            action,
            sources: remaining.length > 1 ? [remaining[1]] : ["any"],
            destinations: remaining.length > 3 ? [remaining[3]] : ["any"],
            services: remaining.length > 0 ? [remaining[0]] : ["ip"],
          });
        }
      }
    }
  } else if (vendor === "FORTINET") {
    let currentRule: Partial<ExtractedRule> | null = null;
    let editLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("edit ") && line.match(/edit\s+\d+/)) {
        editLine = i + 1;
        currentRule = {
          line: editLine,
          sources: [],
          destinations: [],
          services: [],
        };
      } else if (line === "next" && currentRule) {
        if (currentRule.action) {
          rules.push(currentRule as ExtractedRule);
        }
        currentRule = null;
      } else if (currentRule) {
        if (line.startsWith("set name"))
          currentRule.name = line.replace("set name ", "").replace(/"/g, "");
        if (line.startsWith("set action"))
          currentRule.action = line.split(/\s+/)[2];
        if (line.startsWith("set srcaddr"))
          currentRule.sources = line
            .replace("set srcaddr ", "")
            .replace(/"/g, "")
            .split(/\s+/);
        if (line.startsWith("set dstaddr"))
          currentRule.destinations = line
            .replace("set dstaddr ", "")
            .replace(/"/g, "")
            .split(/\s+/);
        if (line.startsWith("set service"))
          currentRule.services = line
            .replace("set service ", "")
            .replace(/"/g, "")
            .split(/\s+/);
      }
    }
  } else if (vendor === "PALO_ALTO") {
    // PAN-OS set commands: track rules by name
    const ruleMap = new Map<string, ExtractedRule>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const ruleMatch = line.match(/set rulebase security rules (\S+)\s+(.*)/);
      if (ruleMatch) {
        const ruleName = ruleMatch[1];
        if (!ruleMap.has(ruleName)) {
          ruleMap.set(ruleName, {
            line: i + 1,
            name: ruleName,
            action: "",
            sources: [],
            destinations: [],
            services: [],
          });
        }
        const rule = ruleMap.get(ruleName)!;
        const rest = ruleMatch[2];
        if (rest.startsWith("action ")) rule.action = rest.split(/\s+/)[1];
        if (rest.startsWith("source ")) rule.sources.push(rest.split(/\s+/)[1]);
        if (rest.startsWith("destination "))
          rule.destinations.push(rest.split(/\s+/)[1]);
        if (rest.startsWith("application ") || rest.startsWith("service "))
          rule.services.push(rest.split(/\s+/)[1]);
      }
    }
    rules.push(...ruleMap.values());
  }

  return rules;
}

function isSubsetOrEqual(subset: string[], superset: string[]): boolean {
  if (
    superset.includes("any") ||
    superset.includes("all") ||
    superset.includes("ALL")
  )
    return true;
  if (subset.length === 0 || superset.length === 0) return false;
  return subset.every(
    (s) => superset.includes(s) || s === "any" || s === "all",
  );
}

function detectShadowedRules(
  config: string,
  vendor: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rules = extractRulesFromConfig(config, vendor);

  for (let i = 1; i < rules.length; i++) {
    for (let j = 0; j < i; j++) {
      const earlier = rules[j];
      const current = rules[i];

      // A rule is shadowed if an earlier rule matches the same or superset of traffic
      const srcShadowed = isSubsetOrEqual(current.sources, earlier.sources);
      const dstShadowed = isSubsetOrEqual(
        current.destinations,
        earlier.destinations,
      );
      const svcShadowed = isSubsetOrEqual(current.services, earlier.services);

      if (
        srcShadowed &&
        dstShadowed &&
        svcShadowed &&
        earlier.action !== current.action
      ) {
        issues.push({
          severity: "warning",
          line: current.line,
          rule: current.name || `Rule at line ${current.line}`,
          message: `Rule may be shadowed by earlier rule "${earlier.name || `line ${earlier.line}`}" (${earlier.action}) — this rule's action (${current.action}) will never apply`,
          suggestion: `Review rule ordering. Move more specific rules before broader rules, or remove the shadowed rule.`,
        });
      }
    }
  }

  return issues;
}

// ============================================================================
// Zone Reference Validation
// ============================================================================

function validateZoneReferences(
  config: string,
  vendor: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = config.split("\n");

  // Collect defined zones
  const definedZones = new Set<string>();
  // Collect referenced zones
  const referencedZones: Array<{ zone: string; line: number }> = [];

  if (vendor === "PALO_ALTO") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Zone definitions
      const zoneDef = line.match(/set network zone (\S+)/);
      if (zoneDef) definedZones.add(zoneDef[1]);
      // Zone references in rules
      const fromMatch = line.match(/rulebase security rules \S+ from\s+(\S+)/);
      if (fromMatch) referencedZones.push({ zone: fromMatch[1], line: i + 1 });
      const toMatch = line.match(/rulebase security rules \S+ to\s+(\S+)/);
      if (toMatch) referencedZones.push({ zone: toMatch[1], line: i + 1 });
    }
  } else if (vendor === "FORTINET") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Zone/interface definitions
      const intfDef = line.match(/edit "?([^"\s]+)"?/);
      if (
        intfDef &&
        lines[Math.max(0, i - 3)]?.includes("config system zone")
      ) {
        definedZones.add(intfDef[1]);
      }
      if (
        intfDef &&
        lines[Math.max(0, i - 3)]?.includes("config system interface")
      ) {
        definedZones.add(intfDef[1]);
      }
      // Zone references in policies
      const srcintf = line.match(/set srcintf "?([^"\s]+)"?/);
      if (srcintf) referencedZones.push({ zone: srcintf[1], line: i + 1 });
      const dstintf = line.match(/set dstintf "?([^"\s]+)"?/);
      if (dstintf) referencedZones.push({ zone: dstintf[1], line: i + 1 });
    }
  } else if (vendor === "JUNIPER_SRX") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Zone definitions
      const zoneDef = line.match(/set security zones security-zone (\S+)/);
      if (zoneDef) definedZones.add(zoneDef[1]);
      // Zone references in policies
      const fromZone = line.match(/from-zone (\S+)/);
      if (fromZone) referencedZones.push({ zone: fromZone[1], line: i + 1 });
      const toZone = line.match(/to-zone (\S+)/);
      if (toZone) referencedZones.push({ zone: toZone[1], line: i + 1 });
    }
  }

  // Only report if we found both zone definitions and references
  if (definedZones.size > 0) {
    for (const ref of referencedZones) {
      if (!definedZones.has(ref.zone) && ref.zone !== "any") {
        issues.push({
          severity: "error",
          line: ref.line,
          message: `Zone "${ref.zone}" referenced but not defined in config`,
          suggestion: `Define zone "${ref.zone}" or check for typos. Defined zones: ${Array.from(definedZones).join(", ")}`,
        });
      }
    }
  }

  return issues;
}

// ============================================================================
// Main Validation Function
// ============================================================================

export function validateConfig(
  config: string,
  vendor: FirewallVendor | string,
): ValidationResult {
  // Run generic checks first
  const genericIssues = validateGeneric(config);

  // Run vendor-specific checks
  let vendorIssues: ValidationIssue[];

  switch (vendor) {
    case "PALO_ALTO":
      vendorIssues = validatePaloAlto(config);
      break;
    case "CISCO_ASA":
    case "CISCO_FTD":
      vendorIssues = validateCiscoASA(config);
      break;
    case "FORTINET":
      vendorIssues = validateFortinet(config);
      break;
    case "CHECKPOINT":
      vendorIssues = validateCheckPoint(config);
      break;
    case "JUNIPER_SRX":
      vendorIssues = validateJuniperSRX(config);
      break;
    default:
      vendorIssues = [];
  }

  // Run cross-rule shadowing detection
  const shadowIssues = detectShadowedRules(config, vendor);

  // Run zone reference validation
  const zoneIssues = validateZoneReferences(config, vendor);

  // Combine and deduplicate
  const allIssues = [
    ...vendorIssues,
    ...genericIssues,
    ...shadowIssues,
    ...zoneIssues,
  ];
  const errors = allIssues.filter((i) => i.severity === "error").length;
  const warnings = allIssues.filter((i) => i.severity === "warning").length;

  return {
    valid: errors === 0,
    vendor,
    totalChecks: allIssues.length + 1, // +1 for the overall check
    errors,
    warnings,
    issues: allIssues,
  };
}
