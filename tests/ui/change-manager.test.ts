/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import { pushBlockReason } from "../../src/lib/ui/change-manager";

const up = { configured: true, connection: { connected: true } };

describe("pushBlockReason", () => {
  it("allows an approved or exported project when Change Manager is reachable", () => {
    expect(pushBlockReason("APPROVED", up)).toBeNull();
    expect(pushBlockReason("EXPORTED", up)).toBeNull();
  });

  it("blocks when Change Manager is not configured or not reachable", () => {
    expect(pushBlockReason("APPROVED", { configured: false, connection: { connected: false } })).toMatch(/not configured/);
    expect(pushBlockReason("APPROVED", { configured: true, connection: { connected: false } })).toMatch(/not reachable/);
    expect(pushBlockReason("APPROVED", null)).toMatch(/Checking/);
  });

  it("blocks projects with rules still to review", () => {
    expect(pushBlockReason("TRANSLATED", up)).toMatch(/Review every rule/);
    expect(pushBlockReason("REVIEWING", up)).toMatch(/Review every rule/);
  });
});
