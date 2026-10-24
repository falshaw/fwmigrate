/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma";
import { PUBLIC_ROUTES, PUBLIC_API_ROUTES } from "@/lib/auth-routes";

const KNOWN_WEAK_SECRETS = [
  "changeme",
  "secret",
  "your-secret",
  "test",
  "development",
  "password",
];

function validateAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret)
    throw new Error("FATAL: AUTH_SECRET environment variable is not set.");
  if (secret.length < 32)
    throw new Error(
      `FATAL: AUTH_SECRET is too short (${secret.length} chars). Minimum 32 required.`,
    );
  for (const weak of KNOWN_WEAK_SECRETS) {
    if (secret.toLowerCase().includes(weak))
      throw new Error(`FATAL: AUTH_SECRET contains weak pattern '${weak}'.`);
  }
  return secret;
}

const validatedSecret = validateAuthSecret();

export const authConfig: NextAuthConfig = {
  secret: validatedSecret,
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const pathname = request.nextUrl.pathname;

      if (
        PUBLIC_ROUTES.some(
          (route) => pathname === route || pathname.startsWith(route + "/"),
        )
      ) {
        if (isLoggedIn && pathname === "/login") {
          return Response.redirect(new URL("/dashboard", request.nextUrl));
        }
        return true;
      }

      if (PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route)))
        return true;

      if (!isLoggedIn) {
        const loginUrl = new URL("/login", request.nextUrl);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return Response.redirect(loginUrl);
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.organizationId = (
          user as { organizationId: string }
        ).organizationId;
        token.organizationName = (
          user as { organizationName: string }
        ).organizationName;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.organizationId = token.organizationId as string;
        session.user.organizationName = token.organizationName as string;
      }
      return session;
    },
  },
};
