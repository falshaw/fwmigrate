/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Review saves are limited per signed-in user with a high ceiling, so fast
 * reviewing never hits the general per-client API limit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const session = vi.hoisted(() => ({ current: null as null | { user: Record<string, string> } }));
vi.mock("@/lib/session", () => ({ getSession: async () => session.current }));

import { apiHandler } from "../../src/lib/apiHandler";
import { RATE_LIMITS } from "../../src/lib/rateLimit";

const ok = async () => NextResponse.json({ ok: true });
let n = 0;
/** Every test uses its own client address so buckets never leak between tests. */
const client = () => `198.51.100.${++n}`;
const req = (ip: string) =>
  new NextRequest("http://localhost/api/v1/x", { method: "PATCH", headers: { "x-real-ip": ip } });
const signIn = (id: string) => {
  session.current = { user: { id, email: `${id}@example.com`, role: "CONSULTANT", organizationId: "org" } };
};

async function statuses(handler: ReturnType<typeof apiHandler>, count: number, ip: string) {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await handler(req(ip))).status);
  return out;
}

describe("rate limits", () => {
  beforeEach(() => {
    session.current = null;
  });

  it("lets a reviewer save 300 decisions in a minute", async () => {
    signIn(`reviewer-${client()}`);
    const review = apiHandler(ok, { rateLimit: RATE_LIMITS.review, rateLimitPrefix: "review-t1", rateLimitBy: "user" });
    const codes = await statuses(review, 300, client());
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it("does not count review saves against the general API limit", async () => {
    signIn(`reviewer-${client()}`);
    const ip = client();
    const review = apiHandler(ok, { rateLimit: RATE_LIMITS.review, rateLimitPrefix: "review-t2", rateLimitBy: "user" });
    const general = apiHandler(ok, { rateLimitPrefix: "api-t2" });
    await statuses(review, 150, ip);
    expect((await general(req(ip))).status).toBe(200);
  });

  it("still caps a single user", async () => {
    signIn(`reviewer-${client()}`);
    const review = apiHandler(ok, { rateLimit: { interval: 60_000, limit: 5 }, rateLimitPrefix: "review-t3", rateLimitBy: "user" });
    const codes = await statuses(review, 6, client());
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it("counts users separately", async () => {
    const review = apiHandler(ok, { rateLimit: { interval: 60_000, limit: 2 }, rateLimitPrefix: "review-t4", rateLimitBy: "user" });
    const ip = client();
    signIn("alice-t4");
    expect(await statuses(review, 3, ip)).toEqual([200, 200, 429]);
    signIn("bob-t4");
    expect(await statuses(review, 1, ip)).toEqual([200]);
  });

  it("rejects an unauthenticated review save", async () => {
    const review = apiHandler(ok, { rateLimit: RATE_LIMITS.review, rateLimitPrefix: "review-t5", rateLimitBy: "user" });
    expect((await review(req(client()))).status).toBe(401);
  });

  it("keeps the general per-client limit of 100 per minute", async () => {
    signIn(`user-${client()}`);
    const general = apiHandler(ok, { rateLimitPrefix: "api-t6" });
    const codes = await statuses(general, 101, client());
    expect(codes.filter((c) => c === 429)).toHaveLength(1);
    expect(codes[100]).toBe(429);
  });
});
