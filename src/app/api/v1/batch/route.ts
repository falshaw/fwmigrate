/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * POST /api/v1/batch — Create a new batch migration
 * GET  /api/v1/batch — List all batch migrations
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { SUPPORTED_VENDORS } from "@/lib/vendors";

const vendorEnum = z.enum(SUPPORTED_VENDORS);

const batchConfigSchema = z.object({
  filename: z.string().min(1).max(255),
  rawConfig: z
    .string()
    .min(10)
    .max(20 * 1024 * 1024),
  sourceVendor: vendorEnum,
  targetVendor: vendorEnum,
});

const createBatchSchema = z.object({
  name: z.string().min(1).max(200),
  configs: z.array(batchConfigSchema).min(1).max(50),
});

type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const GET = apiHandler(async ({ organizationId }) => {
  const batches = await prisma.batchMigration.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      totalConfigs: true,
      completedCount: true,
      failedCount: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ batches, total: batches.length });
});

export const POST = apiHandler<CreateBatchInput>(
  async ({ body, user, organizationId }) => {
    const batch = await prisma.batchMigration.create({
      data: {
        name: body.name,
        organizationId,
        createdById: user.id,
        configs: body.configs.map((c) => ({
          filename: c.filename,
          rawConfig: c.rawConfig,
          sourceVendor: c.sourceVendor,
          targetVendor: c.targetVendor,
        })) as object,
        totalConfigs: body.configs.length,
        status: "pending",
      },
    });

    logger.info("Batch migration created", {
      batchId: batch.id,
      configCount: body.configs.length,
    });

    return NextResponse.json(batch, { status: 201 });
  },
  { schema: createBatchSchema },
);
