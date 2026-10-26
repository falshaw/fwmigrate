/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import type { Role } from "@/generated/prisma";
import { getSession } from "./session";
import { applyRateLimit, RATE_LIMITS, type RateLimitConfig } from "./rateLimit";
import { logger } from "./logger";

/** Roles that may change data. VIEWER reads only. */
export const WRITE_ROLES: Role[] = ["ADMIN", "CONSULTANT"];
export const ALL_ROLES: Role[] = ["ADMIN", "CONSULTANT", "VIEWER"];

interface ApiHandlerOptions<T> {
  schema?: ZodSchema<T>;
  auth?: boolean;
  /**
   * Roles allowed to call the route. Default: every role for GET/HEAD,
   * WRITE_ROLES for every other method.
   */
  roles?: Role[];
  rateLimit?: RateLimitConfig | false;
  rateLimitPrefix?: string;
  /**
   * "client" (default): counted per client address before authentication.
   * "user": counted per signed-in user after authentication, for routes a
   * reviewer clicks quickly (unauthenticated calls are still rejected first).
   */
  rateLimitBy?: "client" | "user";
}

interface UserContext {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
  organizationName: string;
}

interface HandlerContext<T = unknown> {
  body: T;
  user: UserContext;
  organizationId: string;
  req: NextRequest;
  params: Record<string, string>;
}

type HandlerFn<T = unknown> = (ctx: HandlerContext<T>) => Promise<NextResponse>;

export function apiHandler<T = unknown>(
  handler: HandlerFn<T>,
  options: ApiHandlerOptions<T> = {},
) {
  const {
    schema,
    auth: requireAuth = true,
    roles,
    rateLimit = RATE_LIMITS.api,
    rateLimitPrefix = "api",
    rateLimitBy = "client",
  } = options;

  return async (
    req: NextRequest,
    context?: { params?: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      if (rateLimit !== false && rateLimitBy === "client") {
        const limited = await applyRateLimit(req, rateLimit, rateLimitPrefix);
        if (limited) return limited;
      }

      let user: UserContext | undefined;
      if (requireAuth || roles) {
        const session = await getSession();
        if (!session?.user) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        user = session.user as UserContext;

        const allowed = roles ?? (req.method === "GET" || req.method === "HEAD" ? undefined : WRITE_ROLES);
        if (allowed && !allowed.includes(user.role)) {
          return NextResponse.json(
            { error: `Your role (${user.role.toLowerCase()}) cannot do this` },
            { status: 403 },
          );
        }
      }

      if (rateLimit !== false && rateLimitBy === "user") {
        if (!user) {
          // Never skip limiting: fall back to the client address
          const limited = await applyRateLimit(req, rateLimit, rateLimitPrefix);
          if (limited) return limited;
        } else {
          const limited = await applyRateLimit(req, rateLimit, rateLimitPrefix, `user:${user.id}`);
          if (limited) return limited;
        }
      }

      let body: T = undefined as T;
      if (schema) {
        const raw = await req.json();
        body = schema.parse(raw);
      }

      const params = context?.params ? await context.params : {};
      const organizationId = user?.organizationId || "";

      return await handler({ body, user: user!, organizationId, req, params });
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          { error: "Validation failed", details: error.issues },
          { status: 400 },
        );
      }
      if (error instanceof Error) {
        logger.api.error(req.method, req.url, error);
      }
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
