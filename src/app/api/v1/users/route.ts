/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * GET  /api/v1/users — users of the organisation, with lock state (admins)
 * POST /api/v1/users — create a user in the organisation (admins)
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { lockedEmails } from "@/lib/lockout";
import { createUserSchema, type CreateUserInput } from "@/lib/validators/user";

const USER_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export const GET = apiHandler(
  async ({ organizationId }) => {
    const users = await prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: USER_FIELDS,
    });
    const locked = await lockedEmails(users.map((u) => u.email));
    return NextResponse.json({
      users: users.map((u) => ({ ...u, locked: locked.has(u.email) })),
    });
  },
  { roles: ["ADMIN"] },
);

export const POST = apiHandler<CreateUserInput>(
  async ({ body, user, organizationId }) => {
    const exists = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (exists) return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });

    const created = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name || null,
        role: body.role,
        passwordHash: await bcrypt.hash(body.password, 12),
        organizationId,
      },
      select: USER_FIELDS,
    });
    logger.info("User created", { userId: created.id, role: created.role, by: user.id });
    return NextResponse.json({ ...created, locked: false }, { status: 201 });
  },
  { schema: createUserSchema, roles: ["ADMIN"] },
);
