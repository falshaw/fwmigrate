/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * VIEWER reads only: every method except GET/HEAD needs ADMIN or CONSULTANT
 * unless a route names its own roles.
 */

import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const session = vi.hoisted(() => ({ current: null as null | { user: Record<string, string> } }));
vi.mock("@/lib/session", () => ({ getSession: async () => session.current }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: async () =>
        session.current ? { role: session.current.user.dbRole ?? session.current.user.role, isActive: session.current.user.active !== "no" } : null,
    },
  },
}));

import { apiHandler, ALL_ROLES } from "../../src/lib/apiHandler";

const ok = async () => NextResponse.json({ ok: true });
let n = 0;
const req = (method: string) =>
  new NextRequest("http://localhost/api/v1/x", { method, headers: { "x-real-ip": `198.51.100.${++n}` } });
const as = (role: string) => {
  session.current = { user: { id: role, email: `${role}@example.com`, role, organizationId: "org" } };
};

describe("roles", () => {
  it.each(["POST", "PATCH", "DELETE"])("refuses %s for a viewer and allows it for a consultant", async (method) => {
    const handler = apiHandler(ok, { rateLimit: false });
    as("VIEWER");
    const denied = await handler(req(method));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatch(/viewer/);
    as("CONSULTANT");
    expect((await handler(req(method))).status).toBe(200);
  });

  it("lets a viewer read", async () => {
    as("VIEWER");
    expect((await apiHandler(ok, { rateLimit: false })(req("GET"))).status).toBe(200);
  });

  it("uses the role stored now, not the one in the session token, and refuses a deactivated user", async () => {
    as("CONSULTANT");
    session.current!.user.dbRole = "VIEWER"; // an admin changed the role after sign-in
    const handler = apiHandler(ok, { rateLimit: false });
    expect((await handler(req("POST"))).status).toBe(403);
    as("CONSULTANT");
    session.current!.user.active = "no";
    expect((await handler(req("GET"))).status).toBe(401);
  });

  it("route roles override the default", async () => {
    as("VIEWER");
    expect((await apiHandler(ok, { rateLimit: false, roles: ALL_ROLES })(req("POST"))).status).toBe(200);
    as("CONSULTANT");
    expect((await apiHandler(ok, { rateLimit: false, roles: ["ADMIN"] })(req("DELETE"))).status).toBe(403);
  });
});
