/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { recordStatusChange } from "@/lib/projectHistory";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getGenerator } from "@/lib/generators/GeneratorFactory";
import { toNormalizedRule } from "@/lib/mappers/ruleMapper";
import { vendorLabel } from "@/lib/vendors";
import type { FirewallVendor, NormalizedObject } from "@/lib/parsers/types";

/**
 * GET /api/v1/projects/[id]/export?type=config|plan|report
 * type=config: Export translated firewall config in target vendor syntax.
 * type=plan: Export a migration plan with checklists and rollback procedures.
 * type=report: Export a migration summary report (FM-03) with stats, risk, and findings.
 */
export const GET = apiHandler(async ({ params, organizationId, req, user }) => {
  const exportType = new URL(req.url).searchParams.get("type") || "config";

  const project = await prisma.migrationProject.findUnique({
    where: { id: params.id },
    include: {
      translatedRules: {
        where: {
          reviewStatus: { in: ["APPROVED", "MODIFIED"] },
        },
        include: { normalizedRule: true },
        orderBy: {
          normalizedRule: { position: "asc" },
        },
      },
      analysisResults: true,
      normalizedObjects: true,
      zoneMappings: true,
    },
  });

  if (!project) return notFound("Project not found");
  if (project.organizationId !== organizationId)
    return notFound("Project not found");

  if (project.translatedRules.length === 0) {
    return badRequest(
      "No approved or modified rules to export. Review and approve rules first.",
    );
  }

  const timestamp = new Date().toISOString();
  const ruleCount = project.translatedRules.length;

  // Rules the review left out of the export (skipped, flagged), listed in
  // every export so none disappears without a trace
  const leftOut: LeftOutRule[] = (
    await prisma.translatedRule.findMany({
      where: { projectId: params.id, reviewStatus: { notIn: ["APPROVED", "MODIFIED"] } },
      select: { reviewStatus: true, reviewerNote: true, normalizedRule: { select: { position: true, name: true } } },
      orderBy: { normalizedRule: { position: "asc" } },
    })
  ).map((t) => ({
    position: t.normalizedRule.position,
    name: t.normalizedRule.name,
    status: t.reviewStatus,
    note: t.reviewerNote,
  }));
  const report = { project, leftOut, ...splitFindings(project) };

  // Regenerate the approved subset with the generator so the export is a
  // complete config: the objects these rules reference, then the rules
  // (manual overrides replace the generated block of their rule).
  const generator = getGenerator(project.targetVendor as FirewallVendor);
  const rules = project.translatedRules.map((t) => toNormalizedRule(t.normalizedRule));
  const objects: NormalizedObject[] = project.normalizedObjects.map((o) => ({
    objectType: o.objectType as NormalizedObject["objectType"],
    name: o.name,
    members: o.members as string[],
    rawVendorData: o.rawVendorData as Record<string, unknown> | undefined,
  }));
  const zoneMappings = project.zoneMappings.map((z) => ({
    sourceZone: z.sourceZone,
    targetZone: z.targetZone,
  }));
  const overrides: Record<number, string> = {};
  for (const t of project.translatedRules) {
    if (t.reviewStatus === "MODIFIED" && t.manualOverride)
      overrides[t.normalizedRule.position] = t.manualOverride;
  }
  const rollbacks = new Map(
    rules.map((r) => [r.position, generator.generateRollback(r, zoneMappings, objects).command]),
  );

  if (exportType === "plan") {
    const plan = generateMigrationPlan(report, timestamp, rollbacks);
    const filename = `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_migration_plan.md`;

    logger.info("Migration plan exported", {
      projectId: params.id,
      rulesExported: ruleCount,
    });

    return new NextResponse(plan, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (exportType === "report") {
    const text = generateMigrationReport(report, timestamp);
    const filename = `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_migration_report.txt`;

    logger.info("Migration report exported", {
      projectId: params.id,
      rulesExported: ruleCount,
    });

    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Default: export config
  const generated = await generator.generate(rules, objects, zoneMappings, { overrides });
  const c = generator.commentPrefix;
  const header = [
    `${c} =============================================================================`,
    `${c} FW Migrate export -- ${project.name}`,
    `${c} Source: ${vendorLabel(project.sourceVendor)} -> Target: ${vendorLabel(project.targetVendor)}`,
    `${c} Rules exported (approved or modified): ${ruleCount}`,
    ...(leftOut.length
      ? [
          `${c} Left out by the review: ${leftOut.length}`,
          ...leftOut.map((r) => `${c}   ${leftOutLine(r)}`),
        ]
      : []),
    `${c} Generated: ${timestamp}`,
    `${c} Review every line before applying it to a device.`,
    `${c} =============================================================================`,
    ``,
  ].join("\n");

  const fullConfig = header + generated.config + "\n";

  await prisma.migrationProject.update({
    where: { id: params.id },
    data: { status: "EXPORTED" },
  });
  await recordStatusChange(params.id, "EXPORTED", user.id);

  const filename = `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${project.targetVendor}_export.txt`;

  logger.info("Project exported", {
    projectId: params.id,
    rulesExported: ruleCount,
  });

  return new NextResponse(fullConfig, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

interface LeftOutRule {
  position: number;
  name: string;
  status: string;
  note: string | null;
}

function leftOutLine(r: LeftOutRule): string {
  return `#${r.position} ${r.name} (${r.status.toLowerCase()}${r.note ? `: ${r.note.replace(/\s+/g, " ")}` : ""})`;
}

type Finding = ProjectWithRules["analysisResults"][number];

/** Findings on exported rules, and findings on rules the export leaves out. */
function splitFindings(project: ProjectWithRules): { onExported: Finding[]; onLeftOut: Finding[] } {
  const exported = new Set(project.translatedRules.map((t) => String(t.normalizedRule?.position)));
  const onExported: Finding[] = [];
  const onLeftOut: Finding[] = [];
  for (const f of project.analysisResults) (f.ruleId && !exported.has(f.ruleId) ? onLeftOut : onExported).push(f);
  return { onExported, onLeftOut };
}

interface ExportData {
  project: ProjectWithRules;
  leftOut: LeftOutRule[];
  onExported: Finding[];
  onLeftOut: Finding[];
}

interface ProjectWithRules {
  name: string;
  sourceVendor: string;
  targetVendor: string;
  description: string | null;
  translatedRules: Array<{
    reviewStatus: string;
    targetConfig: string;
    manualOverride: string | null;
    confidence: number;
    normalizedRule: {
      position: number;
      name: string;
      sources: unknown;
      destinations: unknown;
      services: unknown;
      action: string;
    } | null;
  }>;
  analysisResults: Array<{
    category: string;
    severity: string;
    /** position of the rule the finding is about */
    ruleId: string | null;
    title: string;
    description: string;
    recommendation: string | null;
  }>;
}

function generateMigrationPlan(
  { project, leftOut, onExported: issues, onLeftOut }: ExportData,
  timestamp: string,
  rollbacks: Map<number, string>,
): string {
  const rules = project.translatedRules;
  const modified = rules.filter((r) => r.reviewStatus === "MODIFIED");
  const avgConfidence =
    rules.length > 0
      ? Math.round(
          (rules.reduce((sum, r) => sum + (r.confidence || 0), 0) /
            rules.length) *
            100,
        )
      : 0;

  const sections: string[] = [];

  // Header
  sections.push(`# Migration Plan: ${project.name}`);
  sections.push(``);
  sections.push(`| Field | Value |`);
  sections.push(`|-------|-------|`);
  sections.push(`| Source Vendor | ${vendorLabel(project.sourceVendor)} |`);
  sections.push(`| Target Vendor | ${vendorLabel(project.targetVendor)} |`);
  sections.push(`| Rules Migrated | ${rules.length} |`);
  sections.push(`| Left Out by Review | ${leftOut.length} |`);
  sections.push(`| Manually Modified | ${modified.length} |`);
  sections.push(`| Avg. Confidence | ${avgConfidence}% |`);
  sections.push(`| Analysis Issues (migrated rules) | ${issues.length} |`);
  sections.push(`| Generated | ${timestamp} |`);
  if (project.description) {
    sections.push(`| Description | ${project.description} |`);
  }
  sections.push(``);

  // Pre-migration checklist
  sections.push(`## Pre-Migration Checklist`);
  sections.push(``);
  sections.push(
    `- [ ] Back up current ${vendorLabel(project.sourceVendor)} running configuration`,
  );
  sections.push(
    `- [ ] Back up current ${vendorLabel(project.targetVendor)} running configuration (if exists)`,
  );
  sections.push(`- [ ] Schedule maintenance window with stakeholders`);
  sections.push(
    `- [ ] Notify affected teams (NOC, security, application owners)`,
  );
  sections.push(
    `- [ ] Verify ${vendorLabel(project.targetVendor)} device is reachable and management access is working`,
  );
  sections.push(`- [ ] Confirm required licenses are active on target device`);
  sections.push(
    `- [ ] Verify all referenced objects/groups exist on target device`,
  );
  sections.push(
    `- [ ] Prepare rollback procedure (tested and documented below)`,
  );
  sections.push(`- [ ] Ensure out-of-band management access for rollback`);
  sections.push(``);

  // Analysis findings
  if (issues.length > 0) {
    sections.push(`## Analysis Findings (${issues.length})`);
    sections.push(``);
    sections.push(
      `**Review these findings before proceeding with migration.**`,
    );
    sections.push(``);
    for (const issue of issues) {
      sections.push(`### [${issue.severity.toUpperCase()}] ${issue.title}`);
      sections.push(``);
      sections.push(`${issue.description}`);
      if (issue.recommendation) {
        sections.push(``);
        sections.push(`**Recommendation:** ${issue.recommendation}`);
      }
      sections.push(``);
    }
  } else {
    sections.push(`## Analysis Findings`);
    sections.push(``);
    sections.push(`No findings on the migrated rules.`);
    sections.push(``);
  }

  if (leftOut.length > 0) {
    sections.push(`## Rules Left Out (${leftOut.length})`);
    sections.push(``);
    sections.push(`Not in this plan or the exported config. Decide what happens to each before the cutover.`);
    sections.push(``);
    for (const r of leftOut) sections.push(`- ${leftOutLine(r)}`);
    if (onLeftOut.length)
      sections.push(``, `${onLeftOut.length} analysis finding(s) concern these rules and are not counted above.`);
    sections.push(``);
  }

  // Rule migration steps
  sections.push(`## Migration Steps`);
  sections.push(``);
  sections.push(
    `Apply the following rules in order on the ${vendorLabel(project.targetVendor)} device:`,
  );
  sections.push(``);

  rules.forEach((translated, step) => {
    const rule = translated.normalizedRule;
    const pos = rule?.position ?? 0;
    const name = rule?.name ?? "unnamed";
    const action = rule?.action ?? "unknown";
    const wasModified = translated.reviewStatus === "MODIFIED";

    sections.push(
      `### Step ${step + 1}: ${name} (source rule #${pos})${wasModified ? " (MANUALLY MODIFIED)" : ""}`,
    );
    sections.push(``);
    sections.push(`| Property | Value |`);
    sections.push(`|----------|-------|`);
    sections.push(`| Action | ${action} |`);
    const sources = Array.isArray(rule?.sources) ? rule.sources : [];
    const destinations = Array.isArray(rule?.destinations)
      ? rule.destinations
      : [];
    const services = Array.isArray(rule?.services) ? rule.services : [];
    sections.push(`| Source | ${sources.join(", ") || "any"} |`);
    sections.push(`| Destination | ${destinations.join(", ") || "any"} |`);
    sections.push(`| Service | ${services.join(", ") || "any"} |`);
    sections.push(
      `| Confidence | ${Math.round((translated.confidence || 0) * 100)}% |`,
    );
    sections.push(``);

    const config =
      wasModified && translated.manualOverride
        ? translated.manualOverride
        : translated.targetConfig;

    sections.push("```");
    sections.push(config);
    sections.push("```");
    sections.push(``);
    sections.push(`- [ ] Applied`);
    sections.push(`- [ ] Verified (traffic flowing correctly)`);
    sections.push(``);
  });

  // Post-migration verification
  sections.push(`## Post-Migration Verification`);
  sections.push(``);
  sections.push(
    `- [ ] Verify all ${rules.length} rules are active and in correct order`,
  );
  sections.push(
    `- [ ] Check hit counts — ensure critical rules are matching traffic`,
  );
  sections.push(`- [ ] Verify logging is working (test with sample traffic)`);
  sections.push(`- [ ] Confirm no unexpected denies in logs`);
  sections.push(`- [ ] Test business-critical applications:`);
  sections.push(`  - [ ] Web/HTTP(S) traffic`);
  sections.push(`  - [ ] DNS resolution`);
  sections.push(`  - [ ] VPN connectivity`);
  sections.push(`  - [ ] Email flow`);
  sections.push(`  - [ ] Application-specific traffic`);
  sections.push(`- [ ] Monitor for 30 minutes for anomalies`);
  sections.push(`- [ ] Get sign-off from application/business owners`);
  sections.push(``);

  // Rollback procedure with per-rule inverse commands (FM-05)
  sections.push(`## Rollback Procedure`);
  sections.push(``);
  sections.push(`If issues are detected during or after migration:`);
  sections.push(``);
  sections.push(
    `1. **Immediate:** Revert to the backed-up ${vendorLabel(project.sourceVendor)} configuration`,
  );
  sections.push(
    `2. **On ${vendorLabel(project.targetVendor)}:** Execute the rollback commands below (reverse order)`,
  );
  sections.push(
    `3. **Verify:** Confirm traffic is flowing through original path`,
  );
  sections.push(
    `4. **Notify:** Inform stakeholders of rollback and schedule new window`,
  );
  sections.push(`5. **Document:** Record what failed and why for next attempt`);
  sections.push(``);
  sections.push(`**Maximum rollback time target:** 15 minutes`);
  sections.push(``);
  sections.push(`### Per-Rule Rollback Commands`);
  sections.push(``);
  sections.push(
    `Execute in **reverse order** (bottom-up) to safely remove migrated rules:`,
  );
  sections.push(``);
  for (let step = rules.length; step >= 1; step--) {
    const rule = rules[step - 1].normalizedRule;
    const pos = rule?.position ?? 0;
    const name = rule?.name ?? "unnamed";
    sections.push(`**Step ${step}: ${name} (source rule #${pos})**`);
    sections.push("```");
    sections.push(rollbacks.get(pos) ?? `# Remove rule "${name}" manually`);
    sections.push("```");
    sections.push(``);
  }
  sections.push(`- [ ] All rollback commands executed`);
  sections.push(`- [ ] Traffic verified flowing on original path`);
  sections.push(``);

  // Sign-off
  sections.push(`## Sign-Off`);
  sections.push(``);
  sections.push(`| Role | Name | Date | Signature |`);
  sections.push(`|------|------|------|-----------|`);
  sections.push(`| Network Engineer | | | |`);
  sections.push(`| Security Lead | | | |`);
  sections.push(`| Change Manager | | | |`);
  sections.push(``);
  sections.push(`---`);
  sections.push(
    `*Generated by FW Migrate*`,
  );
  sections.push(`*FW Migrate -- ${timestamp}*`);

  return sections.join("\n");
}

/**
 * FM-03: Generate migration summary report with stats, risk assessment, and findings.
 */
function generateMigrationReport(
  { project, leftOut, onExported: issues, onLeftOut }: ExportData,
  timestamp: string,
): string {
  const rules = project.translatedRules;

  const approved = rules.filter((r) => r.reviewStatus === "APPROVED").length;
  const modified = rules.filter((r) => r.reviewStatus === "MODIFIED").length;
  const avgConfidence =
    rules.length > 0
      ? (
          rules.reduce((sum, r) => sum + (r.confidence || 0), 0) / rules.length
        ).toFixed(2)
      : "0.00";

  // Confidence distribution
  const highConf = rules.filter((r) => r.confidence >= 0.9).length;
  const medConf = rules.filter(
    (r) => r.confidence >= 0.7 && r.confidence < 0.9,
  ).length;
  const lowConf = rules.filter((r) => r.confidence < 0.7).length;
  // A rule changed by hand no longer ships the generated config, so its
  // generated confidence says nothing about the export; it counts as "changed by hand"
  const lowAsTranslated = rules.filter((r) => r.confidence < 0.7 && r.reviewStatus !== "MODIFIED");

  // Issue severity breakdown
  const criticalIssues = issues.filter(
    (i) => i.severity.toLowerCase() === "critical",
  );
  const highIssues = issues.filter((i) => i.severity.toLowerCase() === "high");
  const mediumIssues = issues.filter(
    (i) => i.severity.toLowerCase() === "medium",
  );
  const lowIssues = issues.filter((i) => i.severity.toLowerCase() === "low");
  const infoIssues = issues.filter((i) => i.severity.toLowerCase() === "info");

  // Issue category breakdown
  const categories = new Map<string, number>();
  for (const issue of issues) {
    categories.set(issue.category, (categories.get(issue.category) || 0) + 1);
  }

  // Action breakdown
  const actions = new Map<string, number>();
  for (const r of rules) {
    const action = r.normalizedRule?.action ?? "unknown";
    actions.set(action, (actions.get(action) || 0) + 1);
  }

  // Risk level from the worst evidence, not an average: one permit any/any/any
  // or one rule that never matches is enough to make a migration risky.
  // Only findings on exported rules count; left-out rules are listed apart.
  const riskReasons: string[] = [];
  if (criticalIssues.length)
    riskReasons.push(`${criticalIssues.length} critical analysis finding(s): ${criticalIssues.map((i) => i.title).join("; ")}`);
  if (lowAsTranslated.length)
    riskReasons.push(`${lowAsTranslated.length} rule(s) approved as translated with low confidence (<70%)`);
  if (highIssues.length) riskReasons.push(`${highIssues.length} high-severity finding(s)`);
  if (mediumIssues.length) riskReasons.push(`${mediumIssues.length} medium-severity finding(s)`);
  if (modified) riskReasons.push(`${modified} rule(s) changed by hand after translation`);
  const riskLevel =
    criticalIssues.length || lowAsTranslated.length
      ? "HIGH"
      : highIssues.length || mediumIssues.length || modified
        ? "MEDIUM"
        : "LOW";

  const s: string[] = [];

  s.push("FIREWALL MIGRATION REPORT");
  s.push("=".repeat(60));
  s.push("");
  s.push(`Project:        ${project.name}`);
  if (project.description) s.push(`Description:    ${project.description}`);
  s.push(`Source Vendor:   ${vendorLabel(project.sourceVendor)}`);
  s.push(`Target Vendor:   ${vendorLabel(project.targetVendor)}`);
  s.push(`Generated:       ${timestamp}`);
  s.push("");

  s.push("EXECUTIVE SUMMARY");
  s.push("-".repeat(60));
  s.push(`  Rules exported:          ${rules.length}`);
  s.push(`  Left out by the review:  ${leftOut.length}`);
  s.push(`  Approved as translated:  ${approved}`);
  s.push(`  Changed by hand:         ${modified}`);
  s.push(
    `  Average Confidence:      ${(parseFloat(avgConfidence) * 100).toFixed(0)}%`,
  );
  s.push(`  Migration risk:          ${riskLevel}`);
  s.push(`  Analysis findings:       ${issues.length} on exported rules, ${onLeftOut.length} on rules left out`);
  s.push("");

  s.push("CONFIDENCE DISTRIBUTION");
  s.push("-".repeat(60));
  s.push(`  High (>=90%):   ${highConf} rules`);
  s.push(`  Medium (70-89%):${medConf} rules`);
  s.push(`  Low (<70%):     ${lowConf} rules`);
  s.push("");

  s.push("RULE ACTION BREAKDOWN");
  s.push("-".repeat(60));
  for (const [action, count] of actions) {
    s.push(`  ${action.padEnd(20)} ${count}`);
  }
  s.push("");

  if (issues.length > 0) {
    s.push("ANALYSIS FINDINGS BY SEVERITY");
    s.push("-".repeat(60));
    if (criticalIssues.length > 0)
      s.push(`  CRITICAL:  ${criticalIssues.length}`);
    if (highIssues.length > 0) s.push(`  HIGH:      ${highIssues.length}`);
    if (mediumIssues.length > 0) s.push(`  MEDIUM:    ${mediumIssues.length}`);
    if (lowIssues.length > 0) s.push(`  LOW:       ${lowIssues.length}`);
    if (infoIssues.length > 0) s.push(`  INFO:      ${infoIssues.length}`);
    s.push("");

    s.push("FINDINGS BY CATEGORY");
    s.push("-".repeat(60));
    for (const [cat, count] of categories) {
      s.push(`  ${cat.padEnd(25)} ${count}`);
    }
    s.push("");

    s.push("DETAILED FINDINGS");
    s.push("-".repeat(60));
    for (const issue of issues) {
      s.push(`  [${issue.severity.toUpperCase()}] ${issue.title}`);
      s.push(`    Category: ${issue.category}`);
      s.push(`    ${issue.description}`);
      if (issue.recommendation) {
        s.push(`    Recommendation: ${issue.recommendation}`);
      }
      s.push("");
    }
  }

  if (leftOut.length > 0) {
    s.push("RULES LEFT OUT OF THE EXPORT");
    s.push("-".repeat(60));
    for (const r of leftOut) s.push(`  ${leftOutLine(r)}`);
    if (onLeftOut.length) {
      s.push("");
      s.push("  Findings on these rules (not counted in the risk):");
      for (const issue of onLeftOut) s.push(`    [${issue.severity.toUpperCase()}] ${issue.title}`);
    }
    s.push("");
  }

  if (lowAsTranslated.length > 0) {
    s.push("LOW-CONFIDENCE RULES (REQUIRE REVIEW)");
    s.push("-".repeat(60));
    for (const r of lowAsTranslated) {
      const name = r.normalizedRule?.name ?? "unnamed";
      const pos = r.normalizedRule?.position ?? 0;
      s.push(
        `  Rule ${pos}: ${name} — Confidence: ${Math.round(r.confidence * 100)}%`,
      );
    }
    s.push("");
  }

  s.push("RISK ASSESSMENT");
  s.push("-".repeat(60));
  s.push(`  Risk level: ${riskLevel}`);
  s.push("  HIGH = any critical finding or a low-confidence rule approved as translated;");
  s.push("  MEDIUM = high or medium findings, or rules changed by hand.");
  s.push("  Counted on the exported rules only.");
  s.push("");
  s.push("  Because of:");
  if (riskReasons.length) for (const r of riskReasons) s.push(`    - ${r}`);
  else s.push("    - no findings above low severity");
  s.push("");

  s.push("=".repeat(60));
  s.push(`Generated by FW Migrate, ${timestamp}`);

  return s.join("\n");
}
