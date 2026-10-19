import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const startTime = Date.now();

export async function GET() {
  // Check if user is authenticated for detailed health info
  const session = await auth();
  const showDetails = !!session?.user;

  let dbHealthy = false;
  let dbLatency: number | undefined;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbHealthy = true;
    if (showDetails) {
      dbLatency = Date.now() - dbStart;
    }
  } catch {
    dbHealthy = false;
  }

  const status = dbHealthy ? "ok" : "degraded";

  // Public response: minimal info for Docker health checks
  if (!showDetails) {
    return NextResponse.json({ status }, { status: dbHealthy ? 200 : 503 });
  }

  // Authenticated response: full details
  return NextResponse.json(
    {
      status: dbHealthy ? "healthy" : "degraded",
      service: "fwmigrate",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: dbHealthy ? "ok" : "error",
          ...(dbLatency !== undefined && { latency: dbLatency }),
        },
      },
    },
    { status: dbHealthy ? 200 : 503 },
  );
}
