"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OverviewProject } from "@/lib/dashboard";
import { vendorShort } from "@/lib/vendors";
import { projectStatusBadge } from "@/lib/ui/rules";
import { DeleteProjectButton } from "./DeleteProjectButton";

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

/**
 * Projects table: the whole row opens the project, the name is the keyboard link.
 * With canDelete, each row gets a delete button with a confirm dialog.
 */
export function ProjectsTable({
  projects,
  canDelete = false,
}: {
  projects: OverviewProject[];
  canDelete?: boolean;
}) {
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
            {canDelete && (
              <th className="w-10">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const badge = projectStatusBadge(p.status);
            const href = `/dashboard/projects/${p.id}`;
            return (
              <tr key={p.id} className="cursor-pointer" onClick={() => router.push(href)}>
                <td className="max-w-[150px] sm:max-w-[240px]">
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
                {canDelete && (
                  // Clicks inside the cell (and its dialog) must not open the project
                  <td className="!py-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <DeleteProjectButton
                      project={p}
                      variant="icon"
                      onDeleted={() => router.refresh()}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
