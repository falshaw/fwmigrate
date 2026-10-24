/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * GET /api/v1/integrate/status — Get Change Manager integration status
 * FM-07: Change Manager Integration
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/apiHandler";
import {
  getChangeManagerConfig,
  testChangeManagerConnection,
} from "@/lib/change-manager-integration";

export const GET = apiHandler(async () => {
  const config = getChangeManagerConfig();
  const connectionTest = await testChangeManagerConnection();

  return NextResponse.json({
    configured: !!config.apiUrl,
    apiUrl: config.apiUrl,
    hasApiKey: !!config.apiKey,
    connection: connectionTest,
  });
});
