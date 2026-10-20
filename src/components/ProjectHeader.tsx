"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

export const FLOW_STEPS = [
  { key: "import", label: "Import" },
  { key: "analysis", label: "Analysis" },
  { key: "translate", label: "Translate" },
  { key: "review", label: "Review" },
  { key: "export", label: "Export" },
] as const;

export type FlowStep = (typeof FLOW_STEPS)[number]["key"];

/** How far a project has got: index of the first step that is not done yet. */
export function reachedStep(status: string | undefined): number {
  switch (status) {
    case "CREATED":
    case "IMPORTING":
    case "PARSING":
      return 0;
    case "PARSED":
    case "ANALYZING":
      return 1;
    case "ANALYZED":
    case "TRANSLATING":
      return 2;
    case "TRANSLATED":
    case "REVIEWING":
      return 3;
    case "APPROVED":
    case "EXPORTED":
      return 4;
    default:
      return 0;
  }
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  sourceVendor: string;
  targetVendor: string;
}

export function StepPills({
  projectId,
  status,
  current,
}: {
  projectId: string;
  status?: string;
  current?: FlowStep;
}) {
  const reached = reachedStep(status);
  return (
    <nav className="steps" aria-label="Migration steps">
      {FLOW_STEPS.map((s, i) => {
        const on = s.key === current;
        const done = !on && (i < reached || (status === "EXPORTED" && i === 4));
        return (
          <Link
            key={s.key}
            href={`/dashboard/projects/${projectId}/${s.key}`}
            className={on ? "on" : done ? "done" : ""}
            aria-current={on ? "step" : undefined}
          >
            {i + 1} {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Header for the project flow pages: breadcrumb, title, actions and the
 * 1-5 step pills. Loads the project name and status itself.
 */
export function ProjectHeader({
  projectId,
  step,
  title,
  subtitle,
  actions,
  onLoad,
}: {
  projectId: string;
  step: FlowStep;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Called once the project is loaded, for pages that need its vendors. */
  onLoad?: (project: ProjectSummary) => void;
}) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/projects/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) {
          const p: ProjectSummary = d.project || d;
          setProject(p);
          onLoadRef.current?.(p);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId]);

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-[18px]">
        <div className="min-w-0">
          <div className="eyebrow truncate">
            <Link href="/dashboard/projects" className="hover:text-ink">
              Projects
            </Link>
            {" / "}
            <Link href={`/dashboard/projects/${projectId}`} className="hover:text-ink">
              {project?.name ?? "…"}
            </Link>
          </div>
          <h1 className="mt-1">{title}</h1>
          {subtitle && <div className="text-ink-65 mt-1">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <StepPills projectId={projectId} status={project?.status} current={step} />
    </div>
  );
}

/** Plain page header for the non-flow pages. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="mt-1 text-[28px]">{title}</h1>
        {subtitle && <div className="text-ink-65 mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
