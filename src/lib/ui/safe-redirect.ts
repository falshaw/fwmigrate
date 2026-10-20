/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Where to go after sign-in. Only same-site app paths are allowed, so a
 * crafted ?callbackUrl= can never send the user to another site.
 */

export function safeCallbackPath(value: string | null | undefined): string {
  if (!value) return "/dashboard";
  let path = value;
  // next-auth sometimes passes an absolute URL on the same origin
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      if (typeof window === "undefined" || u.origin !== window.location.origin) return "/dashboard";
      path = u.pathname + u.search;
    } catch {
      return "/dashboard";
    }
  }
  if (!path.startsWith("/dashboard") || path.startsWith("//") || path.includes("\\")) {
    return "/dashboard";
  }
  return path;
}
