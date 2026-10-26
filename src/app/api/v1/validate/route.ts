/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * POST /api/v1/validate — Validate translated config syntax
 */

import { NextResponse } from "next/server";
import { apiHandler, ALL_ROLES } from "@/lib/apiHandler";
import { validateConfig } from "@/lib/validation/ConfigValidator";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { SUPPORTED_VENDORS } from "@/lib/vendors";

const validateSchema = z.object({
  config: z
    .string()
    .min(1)
    .max(20 * 1024 * 1024),
  vendor: z.enum(SUPPORTED_VENDORS),
});

type ValidateInput = z.infer<typeof validateSchema>;

export const POST = apiHandler<ValidateInput>(
  async ({ body }) => {
    const result = validateConfig(body.config, body.vendor);

    logger.info("Config validation completed", {
      vendor: body.vendor,
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
    });

    return NextResponse.json(result);
  },
  // Read-only check (nothing is stored), so viewers may use it too
  { schema: validateSchema, roles: ALL_ROLES },
);
