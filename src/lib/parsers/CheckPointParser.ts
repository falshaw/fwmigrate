/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Check Point R80+ parser
 * Parses JSON export from `show-access-rulebase` API
 */

import type { IConfigParser } from "./ParserInterface";
import type {
  FirewallVendor,
  ParseResult,
  ValidationResult,
  NormalizedRule,
  NormalizedObject,
  ParseLogEntry,
} from "./types";

export class CheckPointParser implements IConfigParser {
  vendor: FirewallVendor = "CHECKPOINT";

  validate(rawConfig: string): ValidationResult {
    const errors: string[] = [];
    const lineCount = rawConfig.split("\n").length;

    try {
      const data = JSON.parse(rawConfig);
      if (
        !data.rulebase &&
        !data["access-rulebase"] &&
        !data.objects &&
        !Array.isArray(data)
      ) {
        errors.push(
          "JSON does not contain expected Check Point structure (rulebase, objects)",
        );
      }
    } catch {
      errors.push("Config is not valid JSON");
    }

    return {
      valid: errors.length === 0,
      vendor: "CHECKPOINT",
      configType: "json",
      errors,
      lineCount,
    };
  }

  async parse(rawConfig: string): Promise<ParseResult> {
    const log: ParseLogEntry[] = [];
    log.push({ level: "info", message: "Parsing Check Point JSON export" });

    const data = JSON.parse(rawConfig);
    const objectsMap = this.buildObjectMap(data, log);
    const rules = this.parseRulebase(data, objectsMap, log);
    const objects = this.extractObjects(objectsMap, log);

    return {
      rules,
      objects,
      natRules: [],
      interfaces: [],
      routes: [],
      parseLog: log,
      confidence: rules.length > 0 ? 0.85 : 0.4,
      warnings: log.filter((e) => e.level === "warn").map((e) => e.message),
    };
  }

  private buildObjectMap(
    data: Record<string, unknown>,
    log: ParseLogEntry[],
  ): Map<string, { name: string; type: string; value: string }> {
    const map = new Map<
      string,
      { name: string; type: string; value: string }
    >();

    // objects-dictionary contains all referenced objects
    const objectsDictionary = (data["objects-dictionary"] ||
      data.objects ||
      []) as Record<string, unknown>[];

    if (Array.isArray(objectsDictionary)) {
      for (const obj of objectsDictionary) {
        const uid = obj.uid as string;
        const name = (obj.name as string) || uid;
        const type = obj.type as string;

        let value = name;
        if (type === "host" && obj["ipv4-address"])
          value = `${obj["ipv4-address"]}/32`;
        else if (type === "network" && obj["subnet4"] && obj["mask-length4"])
          value = `${obj["subnet4"]}/${obj["mask-length4"]}`;
        else if (type === "CpmiAnyObject") value = "any";

        map.set(uid, { name, type, value });
      }
    }

    log.push({
      level: "info",
      message: `Built object map with ${map.size} entries`,
    });
    return map;
  }

  private parseRulebase(
    data: Record<string, unknown>,
    objectsMap: Map<string, { name: string; type: string; value: string }>,
    log: ParseLogEntry[],
  ): NormalizedRule[] {
    const rules: NormalizedRule[] = [];
    const rulebase = (data.rulebase || data["access-rulebase"] || []) as Record<
      string,
      unknown
    >[];

    const flatRules = this.flattenRulebase(rulebase);

    flatRules.forEach((rule, idx) => {
      if (rule.type === "access-section") return; // Skip section headers

      const resolveObjects = (field: unknown): string[] => {
        if (!Array.isArray(field)) return ["any"];
        return field.map((ref: unknown) => {
          const uid =
            typeof ref === "string"
              ? ref
              : ((ref as Record<string, unknown>)?.uid as string) ||
                ((ref as Record<string, unknown>)?.name as string);
          const obj = objectsMap.get(uid);
          return obj?.value || obj?.name || uid || "any";
        });
      };

      const actionObj = rule.action;
      let action: NormalizedRule["action"] = "deny";
      if (typeof actionObj === "object" && actionObj !== null) {
        const actionName = (
          ((actionObj as Record<string, unknown>).name as string) || ""
        ).toLowerCase();
        action =
          actionName.includes("accept") || actionName.includes("allow")
            ? "permit"
            : actionName.includes("drop")
              ? "drop"
              : "deny";
      } else if (typeof actionObj === "string") {
        action = actionObj.toLowerCase().includes("accept")
          ? "permit"
          : actionObj.toLowerCase().includes("drop")
            ? "drop"
            : "deny";
      }

      rules.push({
        name: (rule.name as string) || `rule-${idx + 1}`,
        position: idx + 1,
        enabled: rule.enabled !== false,
        action,
        sources: resolveObjects(rule.source),
        destinations: resolveObjects(rule.destination),
        services: resolveObjects(rule.service),
        description: rule.comments as string,
        logging: !!(
          rule.track &&
          typeof rule.track === "object" &&
          (rule.track as Record<string, unknown>).type
        ),
        rawVendorData: { uid: rule.uid, ruleNumber: rule["rule-number"] },
      });
    });

    log.push({ level: "info", message: `Parsed ${rules.length} access rules` });
    return rules;
  }

  private flattenRulebase(
    rulebase: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    const flat: Record<string, unknown>[] = [];
    for (const item of rulebase) {
      if (item.type === "access-section" && Array.isArray(item.rulebase)) {
        flat.push(
          ...this.flattenRulebase(item.rulebase as Record<string, unknown>[]),
        );
      } else {
        flat.push(item);
      }
    }
    return flat;
  }

  private extractObjects(
    objectsMap: Map<string, { name: string; type: string; value: string }>,
    log: ParseLogEntry[],
  ): NormalizedObject[] {
    const objects: NormalizedObject[] = [];

    for (const [, obj] of objectsMap) {
      if (["host", "network", "address-range"].includes(obj.type)) {
        objects.push({
          objectType: "address",
          name: obj.name,
          members: [obj.value],
        });
      } else if (obj.type === "group") {
        objects.push({
          objectType: "address-group",
          name: obj.name,
          members: [obj.value],
        });
      }
    }

    log.push({ level: "info", message: `Extracted ${objects.length} objects` });
    return objects;
  }
}
