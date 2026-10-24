/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { z } from "zod";
import { SUPPORTED_VENDORS } from "@/lib/vendors";

export const vendorEnum = z.enum(SUPPORTED_VENDORS);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sourceVendor: vendorEnum,
  targetVendor: vendorEnum,
});

// Security: 20MB max for firewall configs (real-world configs rarely exceed 10MB)
const MAX_CONFIG_SIZE = 20 * 1024 * 1024; // 20MB in bytes

export const importConfigSchema = z.object({
  rawConfig: z
    .string()
    .min(10, "Config must be at least 10 characters")
    .max(
      MAX_CONFIG_SIZE,
      `Config exceeds maximum size of ${MAX_CONFIG_SIZE / (1024 * 1024)}MB`,
    ),
  configType: z.enum(["xml", "text", "json", "set"]).optional(),
  // Replace an already imported config (discards parse, analysis, translation and review)
  replace: z.boolean().optional(),
});

const projectStatusEnum = z.enum([
  "CREATED",
  "IMPORTING",
  "PARSING",
  "PARSED",
  "ANALYZING",
  "ANALYZED",
  "TRANSLATING",
  "TRANSLATED",
  "REVIEWING",
  "APPROVED",
  "EXPORTED",
  "ARCHIVED",
]);

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: projectStatusEnum.optional(),
  })
  .strict();

export const updateRuleReviewSchema = z.object({
  reviewStatus: z.enum(["APPROVED", "MODIFIED", "SKIPPED", "FLAGGED"]),
  reviewerNote: z.string().max(2000).optional(),
  manualOverride: z.string().max(50000).optional(),
});

export const zoneMappingSchema = z.object({
  mappings: z.array(
    z.object({
      sourceZone: z.string(),
      targetZone: z.string(),
      isConfirmed: z.boolean().default(true),
    }),
  ),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ImportConfigInput = z.infer<typeof importConfigSchema>;
export type UpdateRuleReviewInput = z.infer<typeof updateRuleReviewSchema>;
export type ZoneMappingInput = z.infer<typeof zoneMappingSchema>;
