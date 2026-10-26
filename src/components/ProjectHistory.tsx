"use client";

import { useEffect, useState } from "react";
import { projectStatusBadge } from "@/lib/ui/rules";
import { LocalTime } from "./LocalTime";

interface Version {
  id: string;
  version: number;
  fromStatus: string;
  toStatus: string;
  createdAt: string;
  snapshot: {
    ruleCount?: number;
    objectCount?: number;
    translatedCount?: number;
    approvedCount?: number;
    note?: string;
  } | null;
  changedBy: { name: string | null; email: string } | null;
}

/** Every status change of the project: when, by whom, and the counts at the time. */
export function ProjectHistory({ projectId, refreshKey }: { projectId: string; refreshKey?: string }) {
  const [versions, setVersions] = useState<Version[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/projects/${projectId}/versions`)
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((d) => alive && setVersions(d.versions ?? []))
      .catch(() => alive && setVersions([]));
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);

  if (!versions) return null;

  return (
    <section className="card mt-4 p-5" aria-labelledby="history-h">
      <h2 id="history-h" className="mb-3">History</h2>
      {versions.length === 0 ? (
        <p className="text-[13px] text-ink-65">No steps recorded yet.</p>
      ) : (
        <ol className="grid gap-2">
          {versions.map((v) => {
            const to = projectStatusBadge(v.toStatus);
            const s = v.snapshot ?? {};
            const counts = [
              s.ruleCount ? `${s.ruleCount} rules` : "",
              s.translatedCount ? `${s.translatedCount} translated` : "",
              s.approvedCount ? `${s.approvedCount} approved` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-g-line bg-g-bg px-3 py-2 text-[13px]"
              >
                <span className="w-[132px] shrink-0 font-mono text-xs text-ink-65">
                  <LocalTime iso={v.createdAt} />
                </span>
                <span className={`badge ${to.cls}`}>{to.label}</span>
                <span className="min-w-0 flex-1 text-xs text-ink-65">
                  {s.note ?? counts}
                </span>
                <span className="text-xs text-ink-45">{v.changedBy?.name || v.changedBy?.email}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
