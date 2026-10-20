"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, FolderOpen, Activity, CheckCircle2, List } from "lucide-react";
import type { OverviewProject } from "@/lib/dashboard";
import { VENDOR_LIST, vendorShort } from "@/lib/vendors";
import { projectStatusBadge } from "@/lib/ui/rules";
import { PageHeader } from "@/components/ProjectHeader";
import { ProjectsTable } from "@/components/ProjectsTable";

const nf = new Intl.NumberFormat("en-GB");

const ACTIVE = [
  "IMPORTING",
  "PARSING",
  "PARSED",
  "ANALYZING",
  "ANALYZED",
  "TRANSLATING",
  "TRANSLATED",
  "REVIEWING",
];
const DONE = ["APPROVED", "EXPORTED"];

export function ProjectsView({
  projects,
  canDelete = false,
}: {
  projects: OverviewProject[];
  canDelete?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();

  const statuses = useMemo(
    () => [...new Set(projects.map((p) => p.status))].sort(),
    [projects],
  );

  const shown = useMemo(
    () =>
      projects.filter((p) => {
        if (status && p.status !== status) return false;
        if (!q) return true;
        const hay = `${p.name} ${vendorShort(p.sourceVendor)} ${vendorShort(p.targetVendor)}`;
        return hay.toLowerCase().includes(q);
      }),
    [projects, q, status],
  );

  const stats = [
    { label: "Total migrations", value: projects.length, icon: FolderOpen, tone: "text-accent" },
    {
      label: "In progress",
      value: projects.filter((p) => ACTIVE.includes(p.status)).length,
      icon: Activity,
      tone: "text-amber",
    },
    {
      label: "Completed",
      value: projects.filter((p) => DONE.includes(p.status)).length,
      icon: CheckCircle2,
      tone: "text-teal",
    },
    {
      label: "Rules parsed",
      value: projects.reduce((s, p) => s + p.ruleCount, 0),
      icon: List,
      tone: "text-accent",
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Migrations"
        title="Projects"
        subtitle="Every migration project, most recently updated first."
        actions={
          <Link href="/dashboard/projects/new" className="btn btn-primary btn-sm">
            <Plus className="h-4 w-4" aria-hidden /> New migration
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card flex items-center gap-3 p-4">
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-g-line bg-g-bg ${s.tone}`}
              aria-hidden
            >
              <s.icon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <b className="block text-xl leading-tight font-bold tracking-tight">
                {nf.format(s.value)}
              </b>
              <small className="text-xs text-ink-65">{s.label}</small>
            </div>
          </div>
        ))}
      </div>

      <section className="card overflow-hidden" aria-labelledby="all-h">
        <div className="flex flex-wrap items-center gap-3 px-[18px] pt-[18px] pb-3">
          <h2 id="all-h" className="mr-auto !text-base">
            All projects
          </h2>
          <label className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-45"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or vendor…"
              aria-label="Search projects"
              className="input input-glass !h-[38px] !rounded-full !pl-10 text-[13px]"
            />
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className="input input-glass !h-[38px] w-full !rounded-full text-[13px] sm:w-44"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {projectStatusBadge(s).label}
              </option>
            ))}
          </select>
        </div>

        {projects.length === 0 ? (
          <div className="px-[18px] pt-6 pb-10 text-center">
            <FolderOpen className="mx-auto mb-3 h-10 w-10 text-ink-45" aria-hidden />
            <p className="font-semibold">No migration projects yet</p>
            <p className="mt-1 text-[13px] text-ink-65">
              Create a project, paste a source config and translate it to another vendor.
            </p>
            <Link href="/dashboard/projects/new" className="btn btn-primary btn-sm mt-5">
              <Plus className="h-4 w-4" aria-hidden /> New migration
            </Link>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-[18px] pt-4 pb-8 text-center text-[13px] text-ink-65" role="status">
            No projects match the filter.
          </p>
        ) : (
          <ProjectsTable projects={shown} canDelete={canDelete} />
        )}
        {projects.length > 0 && (
          <div className="border-t border-line-2 px-[18px] py-2.5 text-xs text-ink-45" role="status">
            Showing {shown.length} of {projects.length}
          </div>
        )}
      </section>

      <section className="card mt-4 p-[18px]" aria-labelledby="vendors-h">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="vendors-h" className="!text-base">
            Supported vendors
          </h2>
          <span className="text-xs text-ink-65">Parser + generator for each</span>
        </div>
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {VENDOR_LIST.map((v) => (
            <li key={v.id} className="border-t border-line-2 py-2.5 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <b className="font-semibold">{v.label}</b>
                <span className="shrink-0 font-mono text-xs text-ink-45">{v.short}</span>
              </div>
              <div className="mt-0.5 text-xs text-ink-65">
                Reads {v.sourceFormat} · writes {v.targetFormat}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
