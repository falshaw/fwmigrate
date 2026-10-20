"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  List,
  CircleAlert,
  TriangleAlert,
  Search,
  Plus,
  ArrowRight,
} from "lucide-react";
import type { OverviewData, OverviewProject, QueueItem } from "@/lib/dashboard";
import { vendorShort } from "@/lib/vendors";
import { projectStatusBadge } from "@/lib/ui/rules";

const nf = new Intl.NumberFormat("en-GB");

function pairLabel(source: string, target: string) {
  return `${vendorShort(source)}→${vendorShort(target)}`;
}

function matches(p: OverviewProject, q: string) {
  if (!q) return true;
  const hay = `${p.name} ${vendorShort(p.sourceVendor)} ${vendorShort(p.targetVendor)} ${p.status}`;
  return hay.toLowerCase().includes(q);
}

export function OverviewView({ data, today }: { data: OverviewData; today: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const projects = useMemo(() => data.projects.filter((p) => matches(p, q)), [data.projects, q]);
  const queue = useMemo(
    () =>
      data.queue.filter(
        (r) => !q || `${r.name} ${r.projectName}`.toLowerCase().includes(q),
      ),
    [data.queue, q],
  );

  const focus = data.projects.find((p) => p.translated > 0);
  const next = [...data.projects]
    .filter((p) => p.pending > 0)
    .sort((a, b) => b.pending - a.pending)[0];
  const count = data.projects.length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="eyebrow">
            {today} · {count} project{count === 1 ? "" : "s"}
          </div>
          <h1 className="mt-1 !text-[28px]">Overview</h1>
        </div>
        <label className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-45"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, rules…"
            aria-label="Search projects and review queue"
            className="input input-glass !h-[38px] !rounded-full !pl-10 text-[13px]"
          />
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-[1.25fr_.75fr_1.1fr]">
        <ActivityTile activity={data.activity} />

        <div className="grid gap-3">
          <StatTile
            icon={<List className="h-[18px] w-[18px]" />}
            tone="text-accent"
            value={data.totals.rules}
            label="Rules imported"
          />
          <StatTile
            icon={<CircleAlert className="h-[18px] w-[18px]" />}
            tone="text-amber"
            value={data.totals.pending}
            label="Pending review"
          />
          <StatTile
            icon={<TriangleAlert className="h-[18px] w-[18px]" />}
            tone="text-red"
            value={data.totals.risky}
            label="Risky rules"
          />
        </div>

        <ReadinessTile project={focus} />
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="card p-[18px]" aria-labelledby="queue-h">
          <div className="mb-3.5 flex items-center justify-between">
            <h2 id="queue-h" className="!text-base">Review queue</h2>
            {next && (
              <Link
                href={`/dashboard/projects/${next.id}/review`}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Open review
              </Link>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-65">
              {q ? "No queued rules match the search." : "Nothing waiting: no flagged or risky rules."}
            </p>
          ) : (
            <ul>
              {queue.map((r) => (
                <QueueRow key={r.id} item={r} />
              ))}
            </ul>
          )}
        </section>

        <section className="card p-[18px]" aria-labelledby="pairs-h">
          <div className="mb-3.5 flex items-center justify-between">
            <h2 id="pairs-h" className="!text-base">Vendor pairs</h2>
            <span className="text-xs text-ink-65">Projects</span>
          </div>
          {data.pairs.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-65">No projects yet.</p>
          ) : (
            <ul>
              {data.pairs.map((p, i) => {
                const max = data.pairs[0].projects;
                return (
                  <li
                    key={`${p.source}>${p.target}`}
                    className={`flex items-center gap-2 py-2.5 text-[13px] ${i ? "border-t border-line-2" : "pt-0"}`}
                  >
                    <span className="w-36 shrink-0 truncate font-mono text-xs">
                      {pairLabel(p.source, p.target)}
                    </span>
                    <span className="mx-1.5 h-1.5 flex-1 overflow-hidden rounded-full bg-track">
                      <span
                        className={`block h-full rounded-full ${i === 0 ? "bg-accent" : "bg-teal"}`}
                        style={{ width: `${(p.projects / max) * 100}%` }}
                      />
                    </span>
                    <b className="w-6 text-right">{p.projects}</b>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {next ? (
        <Cta
          title={`${nf.format(next.pending)} rule${next.pending === 1 ? "" : "s"} left on ${next.name}`}
          text={`Finish the review and the ${vendorShort(next.targetVendor)} config is ready to export.`}
          href={`/dashboard/projects/${next.id}/review`}
          action="Continue review"
        />
      ) : count === 0 ? (
        <Cta
          title="Start your first migration"
          text="Import a config from any of the five vendors and translate it."
          href="/dashboard/projects/new"
          action="New migration"
        />
      ) : null}

      <section id="projects" className="card mt-4 scroll-mt-6 overflow-hidden" aria-labelledby="projects-h">
        <div className="flex items-center justify-between px-[18px] pt-[18px] pb-2">
          <h2 id="projects-h" className="!text-base">Projects</h2>
          <Link href="/dashboard/projects/new" className="btn btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" aria-hidden /> New migration
          </Link>
        </div>
        {projects.length === 0 ? (
          <p className="px-[18px] pt-4 pb-8 text-center text-[13px] text-ink-65">
            {q ? "No projects match the search." : "No migration projects yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hidden sm:table-cell">Migration</th>
                  <th className="hidden sm:table-cell">Rules</th>
                  <th className="hidden md:table-cell">Approved</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const badge = projectStatusBadge(p.status);
                  return (
                    <tr key={p.id}>
                      <td className="max-w-[220px]">
                        <Link
                          href={`/dashboard/projects/${p.id}`}
                          className="block truncate font-semibold hover:text-accent"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="hidden font-mono text-xs whitespace-nowrap text-ink-65 sm:table-cell">
                        {pairLabel(p.sourceVendor, p.targetVendor)}
                      </td>
                      <td className="hidden sm:table-cell">{nf.format(p.ruleCount)}</td>
                      <td className="hidden md:table-cell text-ink-65">
                        {p.translated ? `${nf.format(p.approved)} / ${nf.format(p.translated)}` : "—"}
                      </td>
                      <td>
                        <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <div className="card flex items-center gap-3 p-[18px]">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-g-line bg-g-bg ${tone}`}
        aria-hidden
      >
        {icon}
      </span>
      <div>
        <b className="block text-xl leading-tight font-bold tracking-tight">{nf.format(value)}</b>
        <small className="text-xs text-ink-65">{label}</small>
      </div>
    </div>
  );
}

function ActivityTile({ activity }: { activity: OverviewData["activity"] }) {
  const max = Math.max(1, ...activity.map((d) => d.count));
  const total = activity.reduce((s, d) => s + d.count, 0);
  return (
    <section className="card p-[18px] md:col-span-2 xl:col-span-1" aria-labelledby="act-h">
      <div className="mb-3.5 flex items-center justify-between">
        <h2 id="act-h" className="!text-base">Review activity</h2>
        <span className="text-xs text-ink-65">Last 7 days · {nf.format(total)} reviewed</span>
      </div>
      <div className="flex h-[180px] items-stretch gap-2.5" role="img" aria-label={`Rules reviewed per day, last 7 days: ${activity.map((d) => d.count).join(", ")}`}>
        {activity.map((d, i) => {
          const h = (d.count / max) * 100;
          const isToday = i === activity.length - 1;
          const day = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", {
            weekday: "short",
            timeZone: "UTC",
          });
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-2">
              <div className="relative w-full flex-1 overflow-hidden rounded-full bg-track">
                {d.count > 0 && (
                  <b
                    className="absolute inset-x-0 bottom-0 rounded-full"
                    style={{
                      height: `${Math.max(h, 12)}%`,
                      background: isToday
                        ? "linear-gradient(180deg,#5eead4,#0d9488)"
                        : "linear-gradient(180deg,#60a5fa,#2563eb)",
                    }}
                  />
                )}
                {d.count > 0 && (
                  <span className="absolute inset-x-0 top-2 text-center text-[10.5px] font-semibold text-ink-65">
                    {d.count}
                  </span>
                )}
              </div>
              <small className="text-[11px] text-ink-65">{day}</small>
            </div>
          );
        })}
      </div>
      {total === 0 && (
        <p className="mt-3 text-center text-xs text-ink-65">No rules reviewed in the last 7 days.</p>
      )}
    </section>
  );
}

function ReadinessTile({ project }: { project?: OverviewProject }) {
  const r = 58;
  const C = 2 * Math.PI * r;
  const total = project ? Math.max(project.ruleCount, project.translated) : 0;
  const approved = project?.approved ?? 0;
  const translated = project?.translated ?? 0;
  const pct = total ? Math.round((approved / total) * 100) : 0;
  const aLen = total ? (approved / total) * C : 0;
  const tLen = total ? (Math.max(0, translated - approved) / total) * C : 0;

  return (
    <section className="card p-[18px]" aria-labelledby="ready-h">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 id="ready-h" className="!text-base">Readiness</h2>
        {project && (
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="truncate text-xs text-ink-65 hover:text-accent"
          >
            {project.name}
          </Link>
        )}
      </div>
      {!project ? (
        <p className="py-10 text-center text-[13px] text-ink-65">
          No translated rules yet. Readiness shows once a project is translated.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-[18px] sm:flex-row">
          <svg
            width="150"
            height="150"
            viewBox="0 0 150 150"
            className="shrink-0"
            role="img"
            aria-label={`${pct}% approved: ${approved} of ${total} rules`}
          >
            <circle cx="75" cy="75" r={r} fill="none" stroke="var(--track)" strokeWidth="16" />
            {aLen > 0 && (
              <circle
                cx="75"
                cy="75"
                r={r}
                fill="none"
                stroke="#14b8a6"
                strokeWidth="16"
                strokeDasharray={`${aLen} ${C}`}
                transform="rotate(-90 75 75)"
              />
            )}
            {tLen > 0 && (
              <circle
                cx="75"
                cy="75"
                r={r}
                fill="none"
                stroke="#2563eb"
                strokeWidth="16"
                strokeDasharray={`${tLen} ${C}`}
                strokeDashoffset={-aLen}
                transform="rotate(-90 75 75)"
              />
            )}
            <text x="75" y="78" textAnchor="middle" fontWeight="700" fontSize="28" fill="var(--ink)">
              {pct}%
            </text>
            <text x="75" y="97" textAnchor="middle" fontSize="11" fill="var(--ink-45)">
              {approved} / {total} rules
            </text>
          </svg>
          <div className="grid w-full flex-1 gap-3 text-xs text-ink-65">
            <Legend color="#2563eb" label="Translated" value={translated} note={`${total ? Math.round((translated / total) * 100) : 0}%`} />
            <Legend color="#14b8a6" label="Approved" value={approved} note={`${pct}%`} />
            <Legend color="var(--amber)" label="Flagged" value={project.flagged} note={project.flagged ? "open" : "none"} warn={project.flagged > 0} />
          </div>
        </div>
      )}
    </section>
  );
}

function Legend({
  color,
  label,
  value,
  note,
  warn,
}: {
  color: string;
  label: string;
  value: number;
  note: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span>
        <span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full" style={{ background: color }} aria-hidden />
        {label}
        <b className="block text-[17px] font-bold text-ink">{nf.format(value)}</b>
      </span>
      <span className={`text-[11.5px] font-semibold ${warn ? "text-amber" : "text-teal"}`}>{note}</span>
    </div>
  );
}

const QUEUE_PILL: Record<QueueItem["state"], { cls: string; label: string; stroke: string }> = {
  flagged: { cls: "b-red", label: "Flagged", stroke: "var(--red)" },
  risk: { cls: "b-red", label: "Risk", stroke: "var(--red)" },
  flag: { cls: "b-amber", label: "Flag", stroke: "var(--amber)" },
  ok: { cls: "b-teal", label: "OK", stroke: "var(--teal)" },
};

function QueueRow({ item }: { item: QueueItem }) {
  const pill = QUEUE_PILL[item.state];
  const C = 2 * Math.PI * 10;
  return (
    <li className="border-t border-line-2 first:border-t-0">
      <Link
        href={`/dashboard/projects/${item.projectId}/review?rule=${item.ruleId}`}
        className="flex items-center gap-3.5 py-3 hover:text-accent"
      >
        <svg width="26" height="26" viewBox="0 0 26 26" className="shrink-0" aria-hidden>
          <circle cx="13" cy="13" r="10" fill="none" stroke="var(--track)" strokeWidth="3" />
          <circle
            cx="13"
            cy="13"
            r="10"
            fill="none"
            stroke={pill.stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - item.confidence)}
            transform="rotate(-90 13 13)"
          />
        </svg>
        <div className="min-w-0">
          <b className="block truncate font-mono text-[13px] font-medium">
            #{String(item.position).padStart(3, "0")} {item.name}
          </b>
          <small className="block truncate text-xs text-ink-65">
            {item.detail} · {Math.round(item.confidence * 100)}% confidence
          </small>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-ink-65">
          <span className="hidden max-w-[140px] truncate sm:inline">{item.projectName}</span>
          <span className={`badge ${pill.cls}`}>{pill.label}</span>
        </div>
      </Link>
    </li>
  );
}

function Cta({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <div className="cta mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
      <div className="relative z-[1]">
        <h3 className="text-xl font-bold">{title}</h3>
        <p className="mt-0.5 text-[13px] opacity-85">{text}</p>
      </div>
      <Link href={href} className="btn relative z-[1] bg-white !text-[#1e40af] hover:bg-white/90">
        {action} <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
