/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { z } from "zod";

export const roleEnum = z.enum(["ADMIN", "CONSULTANT", "VIEWER"]);

/** Sign-in accepts 8+ characters; new passwords set here need 12+. */
const password = z.string().min(12, "At least 12 characters").max(200);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(100).optional(),
  role: roleEnum,
  password,
});

export const updateUserSchema = z
  .object({
    role: roleEnum.optional(),
    isActive: z.boolean().optional(),
    /** Clear the failed sign-in count and any lock */
    unlock: z.literal(true).optional(),
    password: password.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to change" });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
