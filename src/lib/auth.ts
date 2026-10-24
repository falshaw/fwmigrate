/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import NextAuth from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import Redis from "ioredis";
import prisma from "./prisma";
import type { Role } from "@/generated/prisma";
import { authConfig } from "./auth.config";
import { logger } from "./logger";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// --- Brute-force protection ---
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 900;
const LOCKOUT_PREFIX = "fwm:lockout:";
const FAILED_PREFIX = "fwm:failed:";

let _lockoutRedis: Redis | null = null;
function getLockoutRedis(): Redis | null {
  if (!_lockoutRedis && process.env.REDIS_URL) {
    try {
      _lockoutRedis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      _lockoutRedis.connect().catch(() => {
        _lockoutRedis = null;
      });
    } catch {
      _lockoutRedis = null;
    }
  }
  return _lockoutRedis;
}

async function checkAccountLockout(email: string): Promise<boolean> {
  const r = getLockoutRedis();
  if (!r) return false;
  try {
    return (await r.get(`${LOCKOUT_PREFIX}${email}`)) === "1";
  } catch {
    return false;
  }
}

async function recordFailedLogin(email: string): Promise<void> {
  const r = getLockoutRedis();
  if (!r) return;
  try {
    const key = `${FAILED_PREFIX}${email}`;
    const count = await r.incr(key);
    await r.expire(key, LOCKOUT_DURATION_SECONDS);
    if (count >= MAX_FAILED_ATTEMPTS) {
      await r.set(
        `${LOCKOUT_PREFIX}${email}`,
        "1",
        "EX",
        LOCKOUT_DURATION_SECONDS,
      );
    }
  } catch {}
}

async function clearFailedLogins(email: string): Promise<void> {
  const r = getLockoutRedis();
  if (!r) return;
  try {
    await r.del(`${FAILED_PREFIX}${email}`, `${LOCKOUT_PREFIX}${email}`);
  } catch {}
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
        try {
          const { email, password } = loginSchema.parse(credentials);

          if (await checkAccountLockout(email)) return null;

          const user = await prisma.user.findUnique({
            where: { email },
            include: { organization: true },
          });

          if (!user || !user.passwordHash) return null;
          if (!user.isActive) return null;

          const isValid = await bcrypt.compare(password, user.passwordHash);
          if (!isValid) {
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
