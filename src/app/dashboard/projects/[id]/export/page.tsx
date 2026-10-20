"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

export default function ExportPage() {
  const params = useParams();
  const [downloading, setDownloading] = useState(false);

  async function download(type: string) {
    setDownloading(true);
    const res = await fetch(
      `/api/v1/projects/${params.id}/export?type=${type}`,
    );
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fwmigrate-${type}-${params.id}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setDownloading(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Export</h1>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card-luxury p-6">
          <h3 className="text-lg font-semibold text-white mb-2">
            Target Config
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Download the translated firewall configuration in target vendor
            syntax.
          </p>
          <button
            onClick={() => download("config")}
            disabled={downloading}
            className="btn-brand w-full disabled:opacity-50"
          >
            Download Config
          </button>
        </div>

        <div className="card-luxury p-6">
          <h3 className="text-lg font-semibold text-white mb-2">
            Migration Plan
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Download the complete migration plan with checklists and rollback
            procedures.
          </p>
          <button
            onClick={() => download("plan")}
            disabled={downloading}
            className="btn-secondary w-full disabled:opacity-50"
          >
            Download Plan
          </button>
        </div>

        <div className="card-luxury p-6">
          <h3 className="text-lg font-semibold text-white mb-2">
            Migration Report
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Download a summary report with stats, risk assessment, and analysis
            findings.
          </p>
          <button
            onClick={() => download("report")}
            disabled={downloading}
            className="btn-secondary w-full disabled:opacity-50"
          >
            Download Report
          </button>
        </div>
      </div>
    </div>
  );
}
