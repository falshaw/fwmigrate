"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectHeader } from "@/components/ProjectHeader";

interface AnalysisResult {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation?: string;
}

const severityBadge: Record<string, string> = {
  critical: "b-red",
  high: "b-red",
  warning: "b-amber",
  medium: "b-amber",
  low: "b-blue",
  info: "b-blue",
};

export default function AnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [ruleCount, setRuleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Load project info and existing analysis results
    fetch(`/api/v1/projects/${projectId}/analyze`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((data) => {
        setResults(data.results || []);
        setRuleCount(data.ruleCount || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  async function runAnalysis() {
    setAnalyzing(true);
    setError("");
    const res = await fetch(`/api/v1/projects/${projectId}/analyze`, {
      method: "POST",
    });
    if (res.ok) {
      // Reload results after analysis
      const getRes = await fetch(`/api/v1/projects/${projectId}/analyze`);
      if (getRes.ok) {
        const data = await getRes.json();
        setResults(data.results || []);
        setRuleCount(data.ruleCount || 0);
      }
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.detail || data.error || "Analysis failed");
    }
    setAnalyzing(false);
  }

  return (
    <div>
      <ProjectHeader
        projectId={projectId}
        step="analysis"
        title="Rule analysis"
        subtitle={ruleCount > 0 ? `${ruleCount} rules parsed` : undefined}
        actions={
          <>
            <button onClick={runAnalysis} disabled={analyzing} className="btn btn-ghost btn-sm">
              {analyzing ? "Analysing…" : "Run analysis"}
            </button>
            <button
              onClick={() => router.push(`/dashboard/projects/${projectId}/translate`)}
              className="btn btn-primary btn-sm"
            >
              Continue to translation
            </button>
          </>
        }
      />

      {error && (
        <div className="alert alert-error mb-4" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3" aria-busy="true">
          <div className="skeleton h-14" />
          <div className="skeleton h-24" />
        </div>
      ) : results.length === 0 ? (
        <div className="card p-8 text-center text-[13px] text-ink-65">
          No analysis results yet. Run the analysis to find shadowed, unused and over-permissive
          rules.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-[18px] py-3">
            <b>{results.length} findings</b>
            <span className="text-ink-65">across {ruleCount} rules</span>
          </div>
          <ul>
            {results.map((r) => (
              <li key={r.id} className="border-b border-line-2 px-[18px] py-4 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="!text-sm">{r.title}</h2>
                  <span className={`badge ${severityBadge[r.severity] ?? "b-grey"}`}>
                    {r.severity}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink-65">{r.description}</p>
                {r.recommendation && (
                  <p className="mt-2 text-[13px]">
                    <span className="eyebrow mr-2">Fix</span>
                    {r.recommendation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
