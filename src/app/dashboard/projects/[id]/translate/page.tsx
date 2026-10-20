"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [withExplanations, setWithExplanations] = useState(true);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [explain, setExplain] = useState<ExplainState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/v1/projects/${params.id}/translate`)
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
  }, [params.id]);

  function startPolling() {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const d = await fetch(`/api/v1/projects/${params.id}/translate`).then((r) => r.json());
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
    const res = await fetch(`/api/v1/projects/${params.id}/translate`, {
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
      <h1 className="text-2xl font-bold text-white mb-6">Translate Rules</h1>

      <div className="card-luxury p-8 text-center space-y-5">
        <p className="text-gray-400">
          Translates every parsed rule to the target vendor&apos;s syntax. The
          translation is deterministic and finishes in seconds; rules that need
          an engineer&apos;s decision carry a REVIEW flag and a lower confidence.
        </p>

        {llmEnabled ? (
          <label className="flex items-center justify-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={withExplanations}
              onChange={(e) => setWithExplanations(e.target.checked)}
            />
            Add AI explanations in the background (optional, does not change the config)
          </label>
        ) : (
          <p className="text-xs text-gray-500">
            No LLM configured: AI explanations are off. Translation works fully without one.
          </p>
        )}

        {error && <p className="text-red-400">{error}</p>}

        <button onClick={handleTranslate} disabled={loading} className="btn-brand disabled:opacity-50">
          {loading ? "Translating..." : result ? "Translate again" : "Translate All Rules"}
        </button>

        {result && (
          <div className="text-sm text-gray-300 space-y-1">
            <p>
              {result.translatedCount} rules translated in {result.durationMs} ms &middot; average
              confidence {Math.round(result.averageConfidence * 100)}% &middot;{" "}
              {result.rulesWithReviewFlags} with review flags
            </p>
            <button
              onClick={() => router.push(`/dashboard/projects/${params.id}/review`)}
              className="btn-brand mt-3"
            >
              Review rules
            </button>
          </div>
        )}

        {explain && explain.status !== "disabled" && explain.status !== "idle" && (
          <p className="text-xs text-orange-400">
            AI explanations ({explain.provider ?? "LLM"}): {explain.status}
            {typeof explain.total === "number" &&
              ` - ${explain.done ?? 0}/${explain.total} done${explain.failed ? `, ${explain.failed} failed` : ""}${explain.skipped ? `, ${explain.skipped} over the limit` : ""}`}
            {explain.status === "running" && " - you can start reviewing now"}
          </p>
        )}
      </div>
    </div>
  );
}
