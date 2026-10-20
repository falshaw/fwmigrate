/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import { safeCallbackPath } from "../../src/lib/ui/safe-redirect";

describe("safeCallbackPath (login redirect)", () => {
  it("returns to the app page the user came from", () => {
    expect(safeCallbackPath("/dashboard/batch")).toBe("/dashboard/batch");
    expect(safeCallbackPath("/dashboard/projects/abc/review?rule=x")).toBe(
      "/dashboard/projects/abc/review?rule=x",
    );
    expect(safeCallbackPath(`${window.location.origin}/dashboard/validate`)).toBe("/dashboard/validate");
  });

  it("never leaves the app", () => {
    for (const bad of [null, "", "https://evil.example/dashboard", "//evil.example", "/\\evil", "/login", "javascript:alert(1)"])
      expect(safeCallbackPath(bad)).toBe("/dashboard");
  });
});
