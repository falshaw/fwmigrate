"use client";

/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * A timestamp in the viewer's own time zone, in one format everywhere
 * ("25 Oct 2026, 18:42"). The server does not know that zone, so the
 * server render shows UTC (marked) and the browser replaces it.
 */

import { useSyncExternalStore } from "react";

const noop = () => () => {};

export function formatTime(iso: string | Date, timeZone?: string, seconds = false): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds && { second: "2-digit" }),
    ...(timeZone && { timeZone }),
  });
}

/** false during the server render and hydration, true afterwards in the browser */
export function useInBrowser(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function LocalTime({ iso, seconds = false }: { iso: string | Date; seconds?: boolean }) {
  const inBrowser = useInBrowser();
  const value = typeof iso === "string" ? iso : iso.toISOString();
  return (
    <time dateTime={value} suppressHydrationWarning>
      {inBrowser ? formatTime(value, undefined, seconds) : `${formatTime(value, "UTC", seconds)} UTC`}
    </time>
  );
}
