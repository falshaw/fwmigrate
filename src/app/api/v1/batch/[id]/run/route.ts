/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * POST /api/v1/batch/[id]/run — Execute all migrations in a batch
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getParser } from "@/lib/parsers/ParserFactory";
import { getGenerator } from "@/lib/generators/GeneratorFactory";
import type { FirewallVendor } from "@/lib/parsers/types";
import {
  Prisma,
  type FirewallVendor as PrismaFirewallVendor,
} from "@/generated/prisma";

interface BatchConfig {
  filename: string;
  rawConfig: string;
  sourceVendor: string;
  targetVendor: string;
}

interface BatchResult {
  filename: string;
  sourceVendor: string;
  targetVendor: string;
  status: "success" | "failed";
  projectId?: string;
  error?: string;
  ruleCount?: number;
}

export const POST = apiHandler(
  async ({ params, user, organizationId }) => {
    const batch = await prisma.batchMigration.findUnique({
      where: { id: params.id },
    });

    if (!batch) return notFound("Batch migration not found");
    if (batch.organizationId !== organizationId)
      return notFound("Batch migration not found");

    if (batch.status === "running") {
      return badRequest("Batch is already running");
    }

    // Update status to running
    await prisma.batchMigration.update({
      where: { id: params.id },
      data: { status: "running", completedCount: 0, failedCount: 0 },
    });

    const configs = batch.configs as unknown as BatchConfig[];
    const results: BatchResult[] = [];
    let completedCount = 0;
    let failedCount = 0;

    for (const config of configs) {
      try {
        const sourceVendor = config.sourceVendor as FirewallVendor;
        const targetVendor = config.targetVendor as FirewallVendor;

        // Create project
        const project = await prisma.migrationProject.create({
          data: {
            name: `[Batch] ${config.filename}`,
            description: `Auto-created by batch migration: ${batch.name}`,
            sourceVendor: sourceVendor as PrismaFirewallVendor,
            targetVendor: targetVendor as PrismaFirewallVendor,
            organizationId,
            createdById: user.id,
            status: "IMPORTING",
          },
        });

        // Import source config
        const lineCount = config.rawConfig.split("\n").length;
        const configType = config.rawConfig.trim().startsWith("<")
          ? "xml"
          : "text";

        await prisma.sourceConfig.create({
          data: {
            projectId: project.id,
            rawConfig: config.rawConfig,
            configType,
            fileSize: Buffer.byteLength(config.rawConfig, "utf-8"),
            lineCount,
          },
        });

        // Parse
        await prisma.migrationProject.update({
          where: { id: project.id },
          data: { status: "PARSING" },
        });

        const parser = getParser(sourceVendor);
        const parseResult = await parser.parse(config.rawConfig);

        // Store normalized rules
        if (parseResult.rules.length > 0) {
          await prisma.normalizedRule.createMany({
            data: parseResult.rules.map((rule) => ({
              projectId: project.id,
              position: rule.position,
              name: rule.name,
              enabled: rule.enabled,
              action: rule.action,
              sources: rule.sources as object,
              destinations: rule.destinations as object,
              services: rule.services as object,
              sourceZone: rule.sourceZone,
              destinationZone: rule.destinationZone,
              description: rule.description,
              logging: rule.logging,
              rawVendorData: rule.rawVendorData
                ? (rule.rawVendorData as object)
                : Prisma.JsonNull,
            })),
          });
        }

        // Store normalized objects
        if (parseResult.objects.length > 0) {
          await prisma.normalizedObject.createMany({
            data: parseResult.objects.map((obj) => ({
              projectId: project.id,
              objectType: obj.objectType,
              name: obj.name,
              members: obj.members as object,
              rawVendorData: obj.rawVendorData
                ? (obj.rawVendorData as object)
                : Prisma.JsonNull,
            })),
          });
        }

        // Store NAT rules
        if (parseResult.natRules.length > 0) {
          await prisma.normalizedNATRule.createMany({
            data: parseResult.natRules.map((nat) => ({
              projectId: project.id,
              position: nat.position,
              natType: nat.natType,
              originalSource: nat.originalSource as object,
              translatedSource: nat.translatedSource as object,
              originalDest: nat.originalDest as object,
              translatedDest: nat.translatedDest as object,
              service: nat.service ? (nat.service as object) : Prisma.JsonNull,
              rawVendorData: nat.rawVendorData
                ? (nat.rawVendorData as object)
                : Prisma.JsonNull,
            })),
          });
        }

        await prisma.migrationProject.update({
          where: { id: project.id },
          data: {
            status: "PARSED",
            ruleCount: parseResult.rules.length,
            objectCount: parseResult.objects.length,
            natRuleCount: parseResult.natRules.length,
            parseConfidence: parseResult.confidence,
          },
        });

        // Translate using generator
        await prisma.migrationProject.update({
          where: { id: project.id },
          data: { status: "TRANSLATING" },
        });

        const generator = getGenerator(targetVendor);
        const genResult = await generator.generate(
          parseResult.rules,
          parseResult.objects,
          [],
        );

        // Store translated rules
        const normalizedRules = await prisma.normalizedRule.findMany({
          where: { projectId: project.id },
          orderBy: { position: "asc" },
        });

        if (normalizedRules.length > 0) {
          const translatedData = normalizedRules.map((nr) => {
            const ruleConfig = genResult.ruleConfigs.find(
              (rc) => rc.position === nr.position,
            );
            return {
              projectId: project.id,
              normalizedRuleId: nr.id,
              targetConfig:
                ruleConfig?.config ||
                generator.generateRule(
                  parseResult.rules.find((r) => r.position === nr.position)!,
                  [],
                ),
              targetVendor: targetVendor as PrismaFirewallVendor,
              explanation:
                ruleConfig?.explanation || "Auto-translated by batch migration",
              warnings:
                ruleConfig?.warnings && ruleConfig.warnings.length > 0
                  ? (ruleConfig.warnings as object)
                  : Prisma.JsonNull,
              confidence: 0.85,
            };
          });

          await prisma.translatedRule.createMany({ data: translatedData });
        }

        await prisma.migrationProject.update({
          where: { id: project.id },
          data: { status: "TRANSLATED" },
        });

        completedCount++;
        results.push({
          filename: config.filename,
          sourceVendor: config.sourceVendor,
          targetVendor: config.targetVendor,
          status: "success",
          projectId: project.id,
          ruleCount: parseResult.rules.length,
        });
      } catch (err) {
        failedCount++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          filename: config.filename,
          sourceVendor: config.sourceVendor,
          targetVendor: config.targetVendor,
          status: "failed",
          error: errorMsg,
        });
        logger.error("Batch migration config failed", {
          batchId: params.id,
          filename: config.filename,
          error: errorMsg,
        });
      }
    }

    // Update batch with results
    const finalStatus =
      failedCount === configs.length
        ? "failed"
        : failedCount > 0
          ? "completed"
          : "completed";

    await prisma.batchMigration.update({
      where: { id: params.id },
      data: {
        status: finalStatus,
        results: results as object,
        completedCount,
        failedCount,
      },
    });

    logger.info("Batch migration completed", {
      batchId: params.id,
      total: configs.length,
      completed: completedCount,
      failed: failedCount,
    });

    return NextResponse.json({
      status: finalStatus,
      total: configs.length,
      completed: completedCount,
      failed: failedCount,
      results,
    });
  },
  {
    rateLimit: { interval: 60_000, limit: 3 },
    rateLimitPrefix: "batch-run",
  },
);
