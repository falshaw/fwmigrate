/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * GET /api/v1/batch/[id] — Get batch migration status
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound } from "@/lib/errors";

export const GET = apiHandler(async ({ params, organizationId }) => {
  const batch = await prisma.batchMigration.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!batch) return notFound("Batch migration not found");
  if (batch.organizationId !== organizationId)
    return notFound("Batch migration not found");

  // Strip rawConfig from configs to avoid sending large payloads
  const configs = Array.isArray(batch.configs)
    ? (batch.configs as Array<Record<string, unknown>>).map((c) => ({
        filename: c.filename,
        sourceVendor: c.sourceVendor,
        targetVendor: c.targetVendor,
      }))
    : [];

  return NextResponse.json({
    ...batch,
    configs,
  });
});
