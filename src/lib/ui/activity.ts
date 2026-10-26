/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Reviews per calendar day in the viewer's time zone (the server only sends
 * the timestamps; it does not know the viewer's zone).
 */

/** YYYY-MM-DD of `d` in `timeZone` (the runtime's own zone when omitted). */
export function dayIn(d: Date, timeZone?: string): string {
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone && { timeZone }) });
}

/** Counts per day, oldest first, the last `days` days including today. */
export function reviewsPerDay(
  times: string[],
  now: Date,
  timeZone?: string,
  days = 7,
): { date: string; count: number }[] {
  const perDay = new Map<string, number>();
  for (const t of times) {
    const k = dayIn(new Date(t), timeZone);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const out: { date: string; count: number }[] = [];
  // Step back in 24 h jumps from noon today; noon keeps DST shifts on the same day
  const noon = new Date(`${dayIn(now, timeZone)}T12:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const k = dayIn(new Date(noon.getTime() - i * 86_400_000), "UTC");
    out.push({ date: k, count: perDay.get(k) ?? 0 });
  }
  return out;
}
