/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import { reviewsPerDay } from "../../src/lib/ui/activity";

describe("reviewsPerDay", () => {
  const now = new Date("2026-10-25T21:30:00Z");

  it("counts a review on the viewer's calendar day, not the UTC day", () => {
    // Dubai is UTC+4 all year: 22:30 UTC on the 24th is the 25th there,
    // and "now" (21:30 UTC on the 25th) is already the 26th
    const times = ["2026-10-24T22:30:00Z", "2026-10-25T09:00:00Z"];
    const utc = reviewsPerDay(times, now, "UTC");
    const local = reviewsPerDay(times, now, "Asia/Dubai");
    expect(utc.at(-1)).toEqual({ date: "2026-10-25", count: 1 });
    expect(utc.at(-2)).toEqual({ date: "2026-10-24", count: 1 });
    expect(local.at(-1)).toEqual({ date: "2026-10-26", count: 0 });
    expect(local.at(-2)).toEqual({ date: "2026-10-25", count: 2 });
  });

  it("returns seven consecutive days ending today", () => {
    const days = reviewsPerDay([], now, "UTC").map((d) => d.date);
    expect(days).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
    ]);
  });
});
