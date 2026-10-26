/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import NextAuth, { CredentialsSignin } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "./prisma";
import type { Role } from "@/generated/prisma";
import { authConfig } from "./auth.config";
import { logger } from "./logger";
import { clearFailedLogins, isLockedOut, recordFailedLogin } from "./lockout";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/** Shown on the login page; reveals nothing an attacker could not try anyway. */
class AccountLocked extends CredentialsSignin {
  code = "locked";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  debug: false,
  secret: process.env.AUTH_SECRET,
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // A malformed or too short input is a failed sign-in, not a server error
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        if (await isLockedOut(email)) throw new AccountLocked();

        try {
          const user = await prisma.user.findUnique({
            where: { email },
            include: { organization: true },
          });

          const isValid =
            !!user?.passwordHash && user.isActive && (await bcrypt.compare(password, user.passwordHash));
          if (!user || !isValid) {
            await recordFailedLogin(email);
            return null;
          }

          await clearFailedLogins(email);
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          });

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
            organizationId: user.organizationId,
            organizationName: user.organization.name,
          };
        } catch (error) {
          logger.error("Auth error", {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      },
    }),
  ],
});

declare module "next-auth" {
  interface User {
    role: Role;
    organizationId: string;
    organizationName: string;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
      organizationId: string;
      organizationName: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    organizationId: string;
    organizationName: string;
  }
}
