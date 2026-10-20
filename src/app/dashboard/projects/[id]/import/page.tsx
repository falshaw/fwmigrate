"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectHeader } from "@/components/ProjectHeader";

export default function ImportPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [config, setConfig] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleImportAndParse() {
    if (!config.trim()) {
      setError("Please paste a config");
      return;
    }
    setLoading(true);
    setError("");

    // Import
    let res = await fetch(`/api/v1/projects/${projectId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawConfig: config }),
    });

    if (!res.ok) {
      setError("Import failed");
      setLoading(false);
      return;
    }

    // Parse
    res = await fetch(`/api/v1/projects/${projectId}/parse`, {
      method: "POST",
    });
    if (!res.ok) {
      setError("Parse failed");
      setLoading(false);
      return;
    }

    router.push(`/dashboard/projects/${projectId}/analysis`);
  }

  return (
    <div>
      <ProjectHeader projectId={projectId} step="import" title="Import source config" />

      <div className="card grid gap-4 p-5">
        <p className="text-[13px] text-ink-65">
          Paste the source firewall configuration. Supports show running-config, XML exports,
          set commands and JSON exports.
        </p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <label htmlFor="config" className="sr-only">
          Source configuration
        </label>
        <textarea
          id="config"
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          rows={20}
          spellCheck={false}
          placeholder="# paste your firewall config here"
          className="code"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-xs text-ink-45">
            {config ? config.split("\n").length : 0} lines
          </span>
          <button onClick={handleImportAndParse} disabled={loading} className="btn btn-primary">
            {loading ? "Importing and parsing…" : "Import and parse"}
          </button>
        </div>
      </div>
    </div>
  );
}
