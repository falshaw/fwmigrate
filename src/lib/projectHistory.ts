/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Project history: one ProjectVersion row per status change (parse, analysis,
 * translation, review, export), with who did it and the counts at that time.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/** Working states between two steps; they are not worth a history entry. */
const TRANSIENT = new Set(["IMPORTING", "PARSING", "ANALYZING", "TRANSLATING"]);

/**
 * Record that the project reached `toStatus`. The "from" side is the last
 * recorded status, so transient states never show up in the history.
 * Never throws: history must not break the step that triggered it.
 */
export async function recordStatusChange(
  projectId: string,
  toStatus: string,
  userId: string,
  note?: string,
): Promise<void> {
  if (TRANSIENT.has(toStatus)) return;
  try {
    const last = await prisma.projectVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true, toStatus: true },
    });
    const fromStatus = last?.toStatus ?? "CREATED";
    if (fromStatus === toStatus && !note) return;

    const [project, translated, approved] = await Promise.all([
      prisma.migrationProject.findUnique({
        where: { id: projectId },
        select: { ruleCount: true, objectCount: true, natRuleCount: true, parseConfidence: true },
      }),
      prisma.translatedRule.count({ where: { projectId } }),
      prisma.translatedRule.count({
        where: { projectId, reviewStatus: { in: ["APPROVED", "MODIFIED"] } },
      }),
    ]);

    await prisma.projectVersion.create({
      data: {
        projectId,
        version: (last?.version ?? 0) + 1,
        fromStatus,
        toStatus,
        snapshot: { ...project, translatedCount: translated, approvedCount: approved, ...(note ? { note } : {}) },
        changedById: userId,
      },
    });
  } catch (err) {
    logger.warn("Could not record project history", {
      projectId,
      toStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
