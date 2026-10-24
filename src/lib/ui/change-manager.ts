/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * When a project can be pushed to Change Manager, and why not. Used by the
 * project page and the Change Manager page so both disable the button for
 * the same reasons.
 */

export interface ChangeManagerStatus {
  configured: boolean;
  connection: { connected: boolean; error?: string };
}

/** Projects whose rules have all been decided */
export const PUSHABLE_STATUSES = ["APPROVED", "EXPORTED"];

/** Null when the push is possible, otherwise the reason shown next to the disabled button. */
export function pushBlockReason(
  projectStatus: string,
  cm: ChangeManagerStatus | null | undefined,
): string | null {
  if (!cm) return "Checking Change Manager…";
  if (!cm.configured) return "Change Manager is not configured (CHANGE_MANAGER_API_URL).";
  if (!cm.connection.connected) return "Change Manager is not reachable.";
  if (!PUSHABLE_STATUSES.includes(projectStatus)) return "Review every rule first.";
  return null;
}
