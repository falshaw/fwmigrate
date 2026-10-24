/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import { SUPPORTED_VENDORS } from "../../src/lib/vendors";
import { detectVendor } from "../../src/lib/ui/detect-vendor";
import { fixture } from "../generators/helpers";

describe("detectVendor (batch upload)", () => {
  it.each(SUPPORTED_VENDORS.map((v) => [v]))("recognises the %s fixture", (v) => {
    expect(detectVendor(fixture(v))).toBe(v);
  });

  it("falls back to PAN-OS for text it cannot place", () => {
    expect(detectVendor("hello")).toBe("PALO_ALTO");
  });
});
