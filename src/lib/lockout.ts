/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Brute-force protection: five failed sign-ins lock an email address for
 * 15 minutes (kept in Redis). Failures count for unknown addresses too, so
 * a lock message never tells whether an account exists.
 */

import Redis from "ioredis";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_SECONDS = 900;
const LOCKOUT_PREFIX = "fwm:lockout:";
const FAILED_PREFIX = "fwm:failed:";

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!_redis && process.env.REDIS_URL) {
    try {
      _redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      _redis.connect().catch(() => {
        _redis = null;
      });
    } catch {
      _redis = null;
    }
  }
  return _redis;
}

const key = (email: string) => email.trim().toLowerCase();

export async function isLockedOut(email: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    return (await r.get(`${LOCKOUT_PREFIX}${key(email)}`)) === "1";
  } catch {
    return false;
  }
}

/** Which of these addresses are locked right now. */
export async function lockedEmails(emails: string[]): Promise<Set<string>> {
  const r = getRedis();
  if (!r || emails.length === 0) return new Set();
  try {
    const values = await r.mget(emails.map((e) => `${LOCKOUT_PREFIX}${key(e)}`));
    return new Set(emails.filter((_, i) => values[i] === "1"));
  } catch {
    return new Set();
  }
}

export async function recordFailedLogin(email: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const failed = `${FAILED_PREFIX}${key(email)}`;
    const count = await r.incr(failed);
    await r.expire(failed, LOCKOUT_DURATION_SECONDS);
    if (count >= MAX_FAILED_ATTEMPTS) {
      await r.set(`${LOCKOUT_PREFIX}${key(email)}`, "1", "EX", LOCKOUT_DURATION_SECONDS);
    }
  } catch {}
}

/** Clears the failure count and any lock (successful sign-in, or an admin unlock). */
export async function clearFailedLogins(email: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(`${FAILED_PREFIX}${key(email)}`, `${LOCKOUT_PREFIX}${key(email)}`);
  } catch {}
}
