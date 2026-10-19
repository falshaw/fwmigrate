"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface AnalysisResult {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation?: string;
}

export default function AnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [ruleCount, setRuleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Load project info and existing analysis results
    fetch(`/api/v1/projects/${params.id}/analyze`)
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
  }, [params.id]);

  async function runAnalysis() {
    setAnalyzing(true);
    setError("");
    const res = await fetch(`/api/v1/projects/${params.id}/analyze`, {
      method: "POST",
    });
    if (res.ok) {
      // Reload results after analysis
      const getRes = await fetch(`/api/v1/projects/${params.id}/analyze`);
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

  const severityColors: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-red-500/20 text-red-400 border-red-500/30",
    warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Rule Analysis</h1>
          {ruleCount > 0 && (
            <p className="text-sm text-gray-400 mt-1">
              {ruleCount} rules parsed
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="btn-secondary disabled:opacity-50"
          >
            {analyzing ? "Analyzing..." : "Run Analysis"}
          </button>
          <button
            onClick={() =>
              router.push(`/dashboard/projects/${params.id}/translate`)
            }
            className="btn-brand"
          >
            Proceed to Translation
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : results.length === 0 ? (
        <div className="card-luxury p-8 text-center">
          <p className="text-gray-400 mb-4">
            No analysis results yet. Click &quot;Run Analysis&quot; to analyze
            the parsed rules.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card-luxury p-4 mb-4">
            <p className="text-white font-medium">
              {results.length} findings across {ruleCount} rules
            </p>
          </div>
          {results.map((r) => (
            <div
              key={r.id}
              className={`p-4 rounded-lg border ${severityColors[r.severity] || "bg-white/5 border-white/10"}`}
            >
              <div className="flex justify-between items-start">
                <h3 className="font-medium text-white">{r.title}</h3>
                <span className="text-xs uppercase font-bold">
                  {r.severity}
                </span>
              </div>
              <p className="text-sm text-gray-300 mt-1">{r.description}</p>
              {r.recommendation && (
                <p className="text-sm text-gray-400 mt-2 italic">
                  {r.recommendation}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
