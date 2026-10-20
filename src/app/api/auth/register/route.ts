/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { registerSchema } from "@/lib/validators/auth";
import type { RegisterInput } from "@/lib/validators/auth";

const BCRYPT_ROUNDS = 12;

/**
 * POST /api/auth/register
 * Register a new user with a new organization.
 * Creates both the organization and the user in a single transaction.
 * The first user of an organization is assigned the ADMIN role.
 */
export const POST = apiHandler<RegisterInput>(
  async ({ body }) => {
    // Check if email is already registered
    const existingUser = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      select: { id: true },
    });

    if (existingUser) {
      logger.info("Registration attempted for existing email", {
        email: body.email,
      });
      return NextResponse.json(
        { message: "Registration successful. Please check your email." },
        { status: 201 },
      );
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

    // Generate a URL-safe slug from the organization name
    const baseSlug = body.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

    // Ensure slug uniqueness by appending a random suffix if needed
    let slug = baseSlug;
    const existingOrg = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existingOrg) {
      slug = `${baseSlug}-${Date.now().toString(36)}`;
    }

    // Create organization and user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: body.organizationName,
          slug,
        },
      });

      const user = await tx.user.create({
        data: {
          email: body.email.toLowerCase(),
          passwordHash,
          name: body.name,
          role: "ADMIN",
          organizationId: organization.id,
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });

      return { user, organizationId: organization.id };
    });

    logger.info("User registered", {
      userId: result.user.id,
      organizationId: result.organizationId,
    });

    return NextResponse.json(
      {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      { status: 201 },
    );
  },
  {
    schema: registerSchema,
    auth: false,
    rateLimit: { interval: 60_000, limit: 5 },
    rateLimitPrefix: "register",
  },
);
