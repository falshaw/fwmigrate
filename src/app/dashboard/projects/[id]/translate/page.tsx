"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectHeader, type ProjectSummary } from "@/components/ProjectHeader";
import { ZoneMappingCard } from "@/components/ZoneMappingCard";
import { ReadOnlyNote, useCanEdit } from "@/components/RoleContext";

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
  changedRules?: number;
  unchangedRules?: number;
  explain: ExplainState;
}

export default function TranslatePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const canEdit = useCanEdit();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // null until the server has said whether an LLM is configured
  const [llmEnabled, setLlmEnabled] = useState<boolean | null>(null);
  const [withExplanations, setWithExplanations] = useState(true);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [explain, setExplain] = useState<ExplainState | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [zonesChanged, setZonesChanged] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/translate`)
      .then((r) => r.json())
      .then((d) => {
        setLlmEnabled(!!d.llm?.enabled);
        if (d.explain?.status === "running") {
          setExplain(d.explain ? { ...d.explain, provider: d.explain.provider ?? d.llm?.provider } : d.explain);
          startPolling();
        }
      })
      .catch(() => setLlmEnabled(false));
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
        setExplain(d.explain ? { ...d.explain, provider: d.explain.provider ?? d.llm?.provider } : d.explain);
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
      body: JSON.stringify({ explain: !!llmEnabled && withExplanations }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("Translation failed. Check that the configuration was parsed.");
      return;
    }
    const data: TranslateResult = await res.json();
    setResult(data);
    setZonesChanged(false);
    setExplain(data.explain);
    if (data.explain?.status === "running") startPolling();
  }

  return (
    <div>
      <ProjectHeader
        projectId={projectId}
        step="translate"
        title="Translate rules"
        onLoad={setProject}
      />

      {project && (
        <ZoneMappingCard
          projectId={projectId}
          sourceVendor={project.sourceVendor}
          targetVendor={project.targetVendor}
          onSaved={() => setZonesChanged(true)}
        />
      )}

      <div className="card grid max-w-3xl gap-5 p-5 sm:p-6">
        <p className="text-[13px] text-ink-65">
          Translates every parsed rule to the target vendor&apos;s syntax. The translation is
          deterministic and finishes in seconds; rules that need an engineer&apos;s decision carry
          a REVIEW flag and a lower confidence.
        </p>

        {llmEnabled === null ? (
          <p className="text-xs text-ink-45" aria-busy="true">
            Checking for an LLM…
          </p>
        ) : llmEnabled ? (
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

        {zonesChanged && (
          <p className="text-[13px] text-amber-ink" role="status">
            Zone mappings saved. Translate again to apply them to the rules.
          </p>
        )}

        <div>
          {canEdit ? (
            <button
              onClick={handleTranslate}
              disabled={loading || llmEnabled === null}
              className="btn btn-primary"
            >
              {loading ? "Translating…" : result ? "Translate again" : "Translate all rules"}
            </button>
          ) : (
            <ReadOnlyNote action="translate" />
          )}
        </div>

        {result && (
          <div className="grid gap-4 border-t border-line pt-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Translated", String(result.translatedCount)],
                ["Translation confidence (avg)", `${Math.round(result.averageConfidence * 100)}%`],
                ["Review flags", String(result.rulesWithReviewFlags)],
                ["Duration", `${result.durationMs} ms`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-g-line bg-g-bg px-3.5 py-3">
                  <b className="block text-lg font-bold">{value}</b>
                  <small className="text-xs text-ink-65">{label}</small>
                </div>
              ))}
            </div>
            {typeof result.changedRules === "number" && (result.unchangedRules ?? 0) > 0 && (
              <p className="text-[13px] text-ink-65" role="status">
                {result.changedRules === 0
                  ? "Every rule came out the same as before: reviews and the project status are kept."
                  : `${result.changedRules} rules changed and go back to review; ${result.unchangedRules} unchanged rules keep their review.`}
              </p>
            )}
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
