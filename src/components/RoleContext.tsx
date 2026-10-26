"use client";

/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * The signed-in user's role for client pages. The API enforces the same
 * rule (src/lib/apiHandler.ts); this only hides what a viewer cannot use.
 */

import { createContext, useContext } from "react";

export type UserRole = "ADMIN" | "CONSULTANT" | "VIEWER";

const RoleContext = createContext<UserRole>("VIEWER");

export function RoleProvider({ role, children }: { role: UserRole; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): UserRole {
  return useContext(RoleContext);
}

/** VIEWER reads only; ADMIN and CONSULTANT may change data. */
export function useCanEdit(): boolean {
  return useRole() !== "VIEWER";
}

/** Shown in place of an action a viewer cannot take. */
export function ReadOnlyNote({ action }: { action: string }) {
  return (
    <p className="text-xs text-ink-65" role="note">
      Read only: your role can view this, not {action}.
    </p>
  );
}
