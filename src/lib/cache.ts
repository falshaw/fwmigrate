/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import Redis from "ioredis";
import { logger } from "@/lib/logger";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(
  process.env.REDIS_PORT || process.env.REDIS_HOST_PORT || "6383",
  10,
);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const KEY_PREFIX = "fwm:";

let _redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!_redis) {
    _redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy(times: number) {
        return Math.min(times * 200, 5000);
      },
    });
    _redis.on("error", (err) =>
      logger.error("Redis connection error", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    _redis.on("connect", () =>
      logger.info("Redis connected", { host: REDIS_HOST, port: REDIS_PORT }),
    );
    _redis.connect().catch((e) => console.error("Redis connect failed:", e));
  }
  return _redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedisClient().get(`${KEY_PREFIX}${key}`);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    await getRedisClient().set(
      `${KEY_PREFIX}${key}`,
      JSON.stringify(value),
      "EX",
      ttlSeconds,
    );
  } catch {
    /* logged by redis error handler */
  }
}

export async function cacheInvalidate(pattern: string): Promise<void> {
  try {
    const redis = getRedisClient();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${KEY_PREFIX}${pattern}`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* logged */
  }
}

export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const result = await fn();
  cacheSet(key, result, ttlSeconds).catch((e) =>
    console.error("Cache set failed:", e),
  );
  return result;
}
