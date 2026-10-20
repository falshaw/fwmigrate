"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OverviewProject } from "@/lib/dashboard";
import { vendorShort } from "@/lib/vendors";
import { projectStatusBadge } from "@/lib/ui/rules";

const nf = new Intl.NumberFormat("en-GB");

/** Stable on server and client (fixed locale and time zone). */
export function formatUpdated(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Projects table: the whole row opens the project, the name is the keyboard link. */
export function ProjectsTable({ projects }: { projects: OverviewProject[] }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="hidden sm:table-cell">Migration</th>
            <th className="hidden sm:table-cell">Rules</th>
            <th className="hidden md:table-cell">Approved</th>
            <th>Status</th>
            <th className="hidden lg:table-cell">Updated</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const badge = projectStatusBadge(p.status);
            const href = `/dashboard/projects/${p.id}`;
            return (
              <tr key={p.id} className="cursor-pointer" onClick={() => router.push(href)}>
                <td className="max-w-[240px]">
                  <Link
                    href={href}
                    className="block truncate font-semibold hover:text-accent"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="hidden font-mono text-xs whitespace-nowrap text-ink-65 sm:table-cell">
                  {vendorShort(p.sourceVendor)}→{vendorShort(p.targetVendor)}
                </td>
                <td className="hidden sm:table-cell">{nf.format(p.ruleCount)}</td>
                <td className="hidden text-ink-65 md:table-cell">
                  {p.translated ? `${nf.format(p.approved)} / ${nf.format(p.translated)}` : "—"}
                </td>
                <td>
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                </td>
                <td className="hidden text-xs whitespace-nowrap text-ink-65 lg:table-cell">
                  {formatUpdated(p.updatedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
