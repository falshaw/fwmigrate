/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * FM-07: Change Manager Integration Service
 * Manages connection to Change Manager API and rule push operations.
 */

import { logger } from "./logger";

export interface ChangeManagerConnectionConfig {
  apiUrl: string;
  apiKey?: string;
}

export interface ChangeManagerRulePayload {
  name: string;
  action: string;
  sources: string[];
  destinations: string[];
  services: string[];
  sourceZone?: string;
  destinationZone?: string;
  description?: string;
  enabled: boolean;
  status: string;
  migrationSource: {
    projectId: string;
    projectName: string;
    sourceVendor: string;
    targetVendor: string;
    translationConfidence: number;
    originalRuleName: string;
    translatedConfig: string;
  };
}

export interface ChangeManagerPushResult {
  ruleName: string;
  status: "success" | "failed";
  changeManagerRuleId?: string;
  error?: string;
}

export interface ChangeManagerIntegrationResult {
  projectId: string;
  projectName: string;
  totalRules: number;
  success: number;
  failed: number;
  results: ChangeManagerPushResult[];
  changeManagerUrl: string;
  timestamp: string;
}

/**
 * Get the Change Manager connection configuration from environment.
 */
export function getChangeManagerConfig(): ChangeManagerConnectionConfig {
  return {
    apiUrl: process.env.CHANGE_MANAGER_API_URL || "http://localhost:3003",
    apiKey: process.env.CHANGE_MANAGER_API_KEY || undefined,
  };
}

/**
 * Test connectivity to the Change Manager API.
 */
export async function testChangeManagerConnection(): Promise<{
  connected: boolean;
  latencyMs: number;
  version?: string;
  error?: string;
}> {
  const config = getChangeManagerConfig();
  const start = Date.now();

  try {
    const headers: Record<string, string> = {
      "X-Source": "fwmigrate",
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(`${config.apiUrl}/api/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });

    const latencyMs = Date.now() - start;

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        connected: true,
        latencyMs,
        version: data.version || "unknown",
      };
    }

    return {
      connected: false,
      latencyMs,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (err) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Push a single rule to Change Manager.
 */
export async function pushRuleToChangeManager(
  rule: ChangeManagerRulePayload,
): Promise<ChangeManagerPushResult> {
  const config = getChangeManagerConfig();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Source": "fwmigrate",
      "X-Migration-Project": rule.migrationSource.projectId,
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(`${config.apiUrl}/api/rules/import`, {
      method: "POST",
      headers,
      body: JSON.stringify(rule),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        ruleName: rule.name,
        status: "success",
        changeManagerRuleId: data.id || data.ruleId,
      };
    }

    const errorText = await response.text().catch(() => "Unknown error");
    return {
      ruleName: rule.name,
      status: "failed",
      error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
    };
  } catch (err) {
    return {
      ruleName: rule.name,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Push multiple rules to Change Manager with progress tracking.
 */
export async function pushRulesToChangeManager(
  rules: ChangeManagerRulePayload[],
  projectId: string,
  projectName: string,
): Promise<ChangeManagerIntegrationResult> {
  const config = getChangeManagerConfig();
  const results: ChangeManagerPushResult[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const rule of rules) {
    const result = await pushRuleToChangeManager(rule);
    results.push(result);

    if (result.status === "success") {
      successCount++;
    } else {
      failCount++;
    }
  }

  logger.info("Change Manager bulk push completed", {
    projectId,
    totalRules: rules.length,
    success: successCount,
    failed: failCount,
  });

  return {
    projectId,
    projectName,
    totalRules: rules.length,
    success: successCount,
    failed: failCount,
    results,
    changeManagerUrl: config.apiUrl,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build Change Manager-compatible rule payloads from translated rules.
 */
export function buildChangeManagerRules(
  translatedRules: Array<{
    normalizedRule: {
      name: string;
      action: string;
      sources: unknown;
      destinations: unknown;
      services: unknown;
      sourceZone: string | null;
      destinationZone: string | null;
      enabled: boolean;
    };
    targetConfig: string;
    manualOverride: string | null;
    reviewStatus: string;
    confidence: number;
  }>,
  project: {
    id: string;
    name: string;
    sourceVendor: string;
    targetVendor: string;
  },
  description?: string,
): ChangeManagerRulePayload[] {
  return translatedRules.map((tr) => {
    const nr = tr.normalizedRule;
    const sources = Array.isArray(nr.sources) ? (nr.sources as string[]) : [];
    const destinations = Array.isArray(nr.destinations)
      ? (nr.destinations as string[])
      : [];
    const services = Array.isArray(nr.services)
      ? (nr.services as string[])
      : [];

    return {
      name: nr.name,
      action: nr.action,
      sources,
      destinations,
      services,
      sourceZone: nr.sourceZone || undefined,
      destinationZone: nr.destinationZone || undefined,
      description: description
        ? `${description} | Migrated from ${project.sourceVendor}`
        : `Migrated from ${project.sourceVendor} via FW Migrate`,
      enabled: nr.enabled,
      status: "pending_review",
      migrationSource: {
        projectId: project.id,
        projectName: project.name,
        sourceVendor: project.sourceVendor,
        targetVendor: project.targetVendor,
        translationConfidence: tr.confidence,
        originalRuleName: nr.name,
        translatedConfig:
          tr.reviewStatus === "MODIFIED" && tr.manualOverride
            ? tr.manualOverride
            : tr.targetConfig,
      },
    };
  });
}
