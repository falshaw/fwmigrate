/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextRequest, NextResponse } from "next/server";

export interface RateLimitConfig {
  interval: number;
  limit: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL = 60000;
let lastCleanup = Date.now();

function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) rateLimitStore.delete(key);
  }
}

function getClientId(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts[parts.length - 1];
  }
  const ua = req.headers.get("user-agent") || "unknown";
  return `ua-${ua.slice(0, 50)}`;
}

export function checkRateLimit(
  req: NextRequest,
  config: RateLimitConfig,
  prefix: string = "global",
  subject?: string,
): { limited: boolean; remaining: number; resetAt: number } {
  cleanupExpiredEntries();
  const key = `${prefix}:${subject ?? getClientId(req)}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.interval });
    return {
      limited: false,
      remaining: config.limit - 1,
      resetAt: now + config.interval,
    };
  }

  entry.count++;
  if (entry.count > config.limit) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt };
  }
  return {
    limited: false,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
  };
}

export const RATE_LIMITS = {
  auth: { interval: 60 * 1000, limit: 10 },
  api: { interval: 60 * 1000, limit: 100 },
  /** Review decisions, counted per signed-in user: 10 per second sustained for a minute */
  review: { interval: 60 * 1000, limit: 600 },
  expensive: { interval: 60 * 1000, limit: 10 },
  upload: { interval: 60 * 1000, limit: 5 },
};

export async function applyRateLimit(
  req: NextRequest,
  config: RateLimitConfig = RATE_LIMITS.api,
  prefix: string = "api",
  subject?: string,
): Promise<NextResponse | null> {
  const { limited, resetAt } = checkRateLimit(req, config, prefix, subject);
  if (limited) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  return null;
}
