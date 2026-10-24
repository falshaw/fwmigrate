/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from "vitest";
import { fetchAllRules, ruleState, RULES_PAGE_SIZE } from "../../src/lib/ui/rules";

/** Fake rules API: paginates `total` rules the way the real route does. */
function fakeApi(total: number) {
  return vi.fn(async (url: string) => {
    const q = new URL(url, "http://x").searchParams;
    const page = Number(q.get("page") ?? 1);
    const limit = Math.min(200, Number(q.get("limit") ?? 50));
    const start = (page - 1) * limit;
    const rules = Array.from(
      { length: Math.max(0, Math.min(limit, total - start)) },
      (_, i) => ({ id: `r${start + i}` }),
    );
    return { ok: true, json: async () => ({ rules, total, page, limit }) };
  });
}

describe("fetchAllRules", () => {
  it("loads every rule when a project has more than one page (was capped at 50)", async () => {
    const api = fakeApi(450);
    const rules = await fetchAllRules<{ id: string }>("p1", api);
    expect(rules).toHaveLength(450);
    expect(new Set(rules.map((r) => r.id)).size).toBe(450);
    expect(api).toHaveBeenCalledTimes(Math.ceil(450 / RULES_PAGE_SIZE));
    expect(api.mock.calls[0][0]).toBe(
      `/api/v1/projects/p1/rules?page=1&limit=${RULES_PAGE_SIZE}`,
    );
  });

  it("makes one call for a small project and handles an empty one", async () => {
    const small = fakeApi(12);
    expect(await fetchAllRules("p", small)).toHaveLength(12);
    expect(small).toHaveBeenCalledTimes(1);

    const empty = fakeApi(0);
    expect(await fetchAllRules("p", empty)).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
  });

  it("throws when the API fails", async () => {
    const failing = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(fetchAllRules("p", failing)).rejects.toThrow(/Failed to load rules/);
  });
});

describe("ruleState", () => {
  it("marks over-permissive or high-risk rules as risk", () => {
    expect(ruleState({ isOverlyPermissive: true })).toBe("risk");
    expect(ruleState({ riskScore: 7 })).toBe("risk");
    expect(ruleState({ riskScore: 5, warnings: ["REVIEW: x"] })).toBe("flag");
  });

  it("marks REVIEW warnings as flag and the rest as ok", () => {
    expect(ruleState({ warnings: ["REVIEW: app-id has no match"] })).toBe("flag");
    expect(ruleState({ warnings: ["note: logging differs"] })).toBe("ok");
    expect(ruleState({})).toBe("ok");
  });
});
