"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { FileCode2, ListChecks, FileText, Download } from "lucide-react";
import { ProjectHeader } from "@/components/ProjectHeader";

const DOWNLOADS = [
  {
    type: "config",
    title: "Target config",
    text: "The translated firewall configuration in target vendor syntax, with objects.",
    icon: FileCode2,
    primary: true,
  },
  {
    type: "plan",
    title: "Migration plan",
    text: "The full migration plan with checklists and rollback steps.",
    icon: ListChecks,
    primary: false,
  },
  {
    type: "report",
    title: "Migration report",
    text: "A summary with stats, risk assessment and the analysis findings.",
    icon: FileText,
    primary: false,
  },
];

export default function ExportPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [downloading, setDownloading] = useState(false);

  async function download(type: string) {
    setDownloading(true);
    const res = await fetch(`/api/v1/projects/${projectId}/export?type=${type}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fwmigrate-${type}-${projectId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setDownloading(false);
  }

  return (
    <div>
      <ProjectHeader projectId={projectId} step="export" title="Export" />

      <div className="grid gap-4 md:grid-cols-3">
        {DOWNLOADS.map((d) => (
          <div key={d.type} className="card flex flex-col p-5">
            <span
              className={`mb-4 grid h-10 w-10 place-items-center rounded-xl border border-g-line bg-g-bg ${d.primary ? "text-accent" : "text-teal"}`}
              aria-hidden
            >
              <d.icon className="h-[18px] w-[18px]" />
            </span>
            <h2 className="!text-base">{d.title}</h2>
            <p className="mt-1 mb-5 flex-1 text-[13px] text-ink-65">{d.text}</p>
            <button
              onClick={() => download(d.type)}
              disabled={downloading}
              className={`btn w-full ${d.primary ? "btn-primary" : "btn-ghost"}`}
            >
              <Download className="h-4 w-4" aria-hidden />
              Download {d.title.split(" ")[1].toLowerCase()}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
