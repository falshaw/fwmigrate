/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * PATCH /api/v1/users/[id] — change role, deactivate/reactivate, unlock or
 * set a new password (admins, same organisation). The organisation always
 * keeps at least one active admin.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { notFound, badRequest } from "@/lib/errors";
import { clearFailedLogins, lockedEmails } from "@/lib/lockout";
import { updateUserSchema, type UpdateUserInput } from "@/lib/validators/user";

export const PATCH = apiHandler<UpdateUserInput>(
  async ({ body, params, user, organizationId }) => {
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target || target.organizationId !== organizationId) return notFound("User not found");

    const losesAdmin =
      target.role === "ADMIN" &&
      target.isActive &&
      ((body.role !== undefined && body.role !== "ADMIN") || body.isActive === false);
    if (losesAdmin) {
      const admins = await prisma.user.count({
        where: { organizationId, role: "ADMIN", isActive: true },
      });
      if (admins <= 1) return badRequest("The organisation needs at least one active admin.");
    }
    if (target.id === user.id && body.isActive === false)
      return badRequest("You cannot deactivate your own account.");

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(body.role !== undefined && { role: body.role }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.password !== undefined && { passwordHash: await bcrypt.hash(body.password, 12) }),
      },
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });
    // A new password or an explicit unlock clears the lock
    if (body.unlock || body.password !== undefined) await clearFailedLogins(target.email);

    logger.info("User updated", {
      userId: target.id,
      by: user.id,
      changed: Object.keys(body), // field names only, never the password
    });
    const locked = await lockedEmails([updated.email]);
    return NextResponse.json({ ...updated, locked: locked.has(updated.email) });
  },
  { schema: updateUserSchema, roles: ["ADMIN"] },
);
