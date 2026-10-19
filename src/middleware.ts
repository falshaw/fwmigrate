/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";

const authMiddleware = NextAuth(authConfig).auth;

// Build Content-Security-Policy header
function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Attach security headers to a response
function applySecurityHeaders(response: NextResponse): NextResponse {
  const csp = buildCsp();
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  return response;
}

function csrfCheck(request: NextRequest): NextResponse | null {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const pathname = request.nextUrl.pathname;
    if (pathname.startsWith("/api/auth")) return null;
    if (pathname.startsWith("/api/")) {
      const origin = request.headers.get("origin");
      const host = request.headers.get("host");
      if (origin && host) {
        try {
          if (new URL(origin).host !== host) {
            return applySecurityHeaders(
              NextResponse.json(
                { error: "CSRF validation failed" },
                { status: 403 },
              ),
            );
          }
        } catch {
          return applySecurityHeaders(
            NextResponse.json(
              { error: "CSRF validation failed" },
              { status: 403 },
            ),
          );
        }
      } else if (!origin) {
        return applySecurityHeaders(
          NextResponse.json(
            { error: "CSRF validation failed: missing Origin" },
            { status: 403 },
          ),
        );
      }
    }
  }
  return null;
}

export default function middleware(request: NextRequest) {
  const csrfResponse = csrfCheck(request);
  if (csrfResponse) return csrfResponse;

  const authResponse = (
    authMiddleware as unknown as (
      req: NextRequest,
    ) => ReturnType<typeof NextResponse.next>
  )(request);

  // Wrap auth response with security headers
  if (authResponse instanceof Promise) {
    return authResponse.then((res) => {
      if (res) return applySecurityHeaders(res as NextResponse);
      return applySecurityHeaders(NextResponse.next());
    });
  }

  if (authResponse) return applySecurityHeaders(authResponse as NextResponse);
  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|fonts|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
