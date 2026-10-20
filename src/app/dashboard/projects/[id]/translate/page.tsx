"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectHeader } from "@/components/ProjectHeader";

interface ExplainState {
  status: string;
  total?: number;
  done?: number;
  failed?: number;
  skipped?: number;
  provider?: string;
  lastError?: string;
}

interface TranslateResult {
  translatedCount: number;
  averageConfidence: number;
  rulesWithReviewFlags: number;
  durationMs: number;
  explain: ExplainState;
}

export default function TranslatePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [withExplanations, setWithExplanations] = useState(true);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [explain, setExplain] = useState<ExplainState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/translate`)
      .then((r) => r.json())
      .then((d) => {
        setLlmEnabled(!!d.llm?.enabled);
        if (d.explain?.status === "running") {
          setExplain(d.explain);
          startPolling();
        }
      })
      .catch(() => undefined);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function startPolling() {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const d = await fetch(`/api/v1/projects/${projectId}/translate`).then((r) => r.json());
        setExplain(d.explain);
        if (d.explain?.status !== "running" && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
  }

  async function handleTranslate() {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/v1/projects/${projectId}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ explain: llmEnabled && withExplanations }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("Translation failed. Check that the configuration was parsed.");
      return;
    }
    const data: TranslateResult = await res.json();
    setResult(data);
    setExplain(data.explain);
    if (data.explain?.status === "running") startPolling();
  }

  return (
    <div>
      <ProjectHeader projectId={projectId} step="translate" title="Translate rules" />

      <div className="card grid max-w-3xl gap-5 p-5 sm:p-6">
        <p className="text-[13px] text-ink-65">
          Translates every parsed rule to the target vendor&apos;s syntax. The translation is
          deterministic and finishes in seconds; rules that need an engineer&apos;s decision carry
          a REVIEW flag and a lower confidence.
        </p>

        {llmEnabled ? (
          <label className="flex items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={withExplanations}
              onChange={(e) => setWithExplanations(e.target.checked)}
            />
            Add AI explanations in the background (optional, does not change the config)
          </label>
        ) : (
          <p className="text-xs text-ink-45">
            No LLM configured: AI explanations are off. Translation works fully without one.
          </p>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div>
          <button onClick={handleTranslate} disabled={loading} className="btn btn-primary">
            {loading ? "Translating…" : result ? "Translate again" : "Translate all rules"}
          </button>
        </div>

        {result && (
          <div className="grid gap-4 border-t border-line pt-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Translated", String(result.translatedCount)],
                ["Avg confidence", `${Math.round(result.averageConfidence * 100)}%`],
                ["Review flags", String(result.rulesWithReviewFlags)],
                ["Duration", `${result.durationMs} ms`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-g-line bg-g-bg px-3.5 py-3">
                  <b className="block text-lg font-bold">{value}</b>
                  <small className="text-xs text-ink-65">{label}</small>
                </div>
              ))}
            </div>
            <div>
              <button
                onClick={() => router.push(`/dashboard/projects/${projectId}/review`)}
                className="btn btn-primary"
              >
                Review rules
              </button>
            </div>
          </div>
        )}

        {explain && explain.status !== "disabled" && explain.status !== "idle" && (
          <p className="text-xs text-accent" role="status">
            AI explanations ({explain.provider ?? "LLM"}): {explain.status}
            {typeof explain.total === "number" &&
              ` - ${explain.done ?? 0}/${explain.total} done${explain.failed ? `, ${explain.failed} failed` : ""}${explain.skipped ? `, ${explain.skipped} over the limit` : ""}`}
            {explain.status === "running" && " - you can start reviewing now"}
            {explain.failed && explain.lastError ? ` (last error: ${explain.lastError})` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
