/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Resolves the Postgres connection string.
 *
 * - Inside Docker, compose sets DATABASE_URL (least-privilege app role).
 * - On the host (Prisma CLI, seed, `npm run dev`) DATABASE_URL may be unset;
 *   it is then built from POSTGRES_PASSWORD + POSTGRES_PORT in .env, so the
 *   password lives in exactly one place.
 */

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_PASSWORD) {
    const port = env.POSTGRES_PORT || "5436";
    return `postgresql://postgres:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${port}/fwmigrate`;
  }
  return undefined;
}
