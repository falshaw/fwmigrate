/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { auth } from "@/lib/auth";
import type { Session } from "next-auth";
import { logger } from "./logger";

export async function getSession(): Promise<Session | null> {
  try {
    return await auth();
  } catch (error) {
    logger.warn("Session retrieval failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.user) throw new Error("Unauthorized");
  return session.user;
}
