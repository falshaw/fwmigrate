/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * POST /api/v1/validate — Validate translated config syntax
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import { validateConfig } from "@/lib/validation/ConfigValidator";
import { logger } from "@/lib/logger";
import { z } from "zod";

const validateSchema = z.object({
  config: z
    .string()
    .min(1)
    .max(20 * 1024 * 1024),
  vendor: z.enum([
    "PALO_ALTO",
    "CISCO_ASA",
    "CISCO_FTD",
    "CHECKPOINT",
    "FORTINET",
    "JUNIPER_SRX",
    "SOPHOS",
    "SONICWALL",
    "WATCHGUARD",
    "PFSENSE",
    "MIKROTIK",
  ]),
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
  { schema: validateSchema },
);
