"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { ProjectHeader, type ProjectSummary } from "@/components/ProjectHeader";
import { ReadOnlyNote, useCanEdit } from "@/components/RoleContext";
import { CodeBlock } from "@/components/CodeBlock";
import { vendorShort } from "@/lib/vendors";
import {
  fetchAllRules,
  RulesLoadError,
  ruleState,
  RULE_STATE_BADGE,
  REVIEW_STATUS_BADGE,
} from "@/lib/ui/rules";

interface NormalizedRuleWithTranslation {
  id: string;
  name: string;
  position: number;
  action: string;
  enabled?: boolean;
  logging?: boolean;
  description?: string | null;
  sources: string[];
  destinations: string[];
  services: string[];
  sourceZone?: string | null;
  destinationZone?: string | null;
  isOverlyPermissive?: boolean;
  riskScore?: number | null;
  analysisNotes?: string | null;
  translatedRule?: {
    id: string;
    targetConfig: string;
    explanation: string;
    aiExplanation?: string | null;
    aiModel?: string | null;
    warnings?: string[] | null;
    confidence: number;
    reviewStatus: string;
    reviewerNote?: string | null;
    manualOverride?: string | null;
  };
}

/** Extra fields sent with a decision */
interface ReviewExtra {
  reviewerNote?: string;
  manualOverride?: string;
}

type Rule = NormalizedRuleWithTranslation & {
  translatedRule: NonNullable<NormalizedRuleWithTranslation["translatedRule"]>;
};

const list = (v: string[]) => (v.length ? v.join(" ") : "any");

/** The parsed source rule, laid out like config. */
function sourceText(rule: Rule, vendor: string) {
  const lines = [
    `# parsed from ${vendor}`,
    `rule "${rule.name}"`,
    `  from ${rule.sourceZone ?? "any"} to ${rule.destinationZone ?? "any"}`,
    `  source ${list(rule.sources)}`,
    `  destination ${list(rule.destinations)}`,
    `  service ${list(rule.services)}`,
    `  action ${rule.action}`,
  ];
  if (rule.logging) lines.push("  log");
  if (rule.enabled === false) lines.push("  disabled");
  return lines.join("\n");
}

function pad(n: number) {
  return `#${String(n).padStart(3, "0")}`;
}

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [rules, setRules] = useState<NormalizedRuleWithTranslation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    fetchAllRules<NormalizedRuleWithTranslation>(projectId)
      .then((all) => {
        setRules(all);
        const wanted = new URLSearchParams(window.location.search).get("rule");
        const withT = all.filter((r) => r.translatedRule);
        const first =
          withT.find((r) => r.id === wanted) ??
          withT.find((r) => r.translatedRule!.reviewStatus === "PENDING") ??
          withT[0];
        setSelectedId(first?.id ?? null);
        setLoading(false);
      })
      .catch((e) => {
        setLoadError(
          e instanceof RulesLoadError && e.status === 429
            ? "Could not load the rules: too many requests in a short time. Wait a minute and try again."
            : "Could not load the rules.",
        );
        setLoading(false);
      });
  }, [projectId, attempt]);

  async function reviewRule(normalizedRuleId: string, status: string, extra: ReviewExtra = {}) {
    setSaving(true);
    setSaveError("");
    const res = await fetch(`/api/v1/projects/${projectId}/rules/${normalizedRuleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus: status, ...extra }),
    }).catch(() => null);
    setSaving(false);
    // Only show the decision once the server has stored it.
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setSaveError(
        res?.status === 429
          ? `Too many changes in a short time. Wait ${data.retryAfter ?? "a few"} seconds and try again.`
          : data.error || "The decision was not saved. Try again.",
      );
      return;
    }
    const saved = (await res.json().catch(() => null)) as NormalizedRuleWithTranslation | null;
    setRules((prev) =>
      prev.map((r) =>
        r.id === normalizedRuleId
          ? {
              ...r,
              translatedRule: {
                ...r.translatedRule!,
                reviewStatus: status,
                reviewerNote: saved?.translatedRule?.reviewerNote ?? null,
                manualOverride: saved?.translatedRule?.manualOverride ?? null,
              },
            }
          : r,
      ),
    );
    // Move on to the next rule that still waits for a decision.
    const idx = withTranslation.findIndex((r) => r.id === normalizedRuleId);
    const nextPending = [...withTranslation.slice(idx + 1), ...withTranslation.slice(0, idx)].find(
      (r) => r.translatedRule.reviewStatus === "PENDING",
    );
    if (nextPending) setSelectedId(nextPending.id);
  }

  const withTranslation = rules.filter((r): r is Rule => !!r.translatedRule);
  const reviewed = withTranslation.filter(
    (r) => r.translatedRule.reviewStatus !== "PENDING",
  ).length;
  const total = withTranslation.length;
  const selected = withTranslation.find((r) => r.id === selectedId) ?? null;
  const src = project ? vendorShort(project.sourceVendor) : "source";
  const tgt = project ? vendorShort(project.targetVendor) : "target";

  return (
    <div>
      <ProjectHeader
        projectId={projectId}
        step="review"
        title="Review rules"
        onLoad={setProject}
        subtitle={total > 0 ? `${reviewed} of ${total} rules reviewed` : undefined}
        actions={
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}/export`)}
            className="btn btn-primary btn-sm"
            disabled={loading || !!loadError || total === 0 || reviewed < total}
            title={reviewed < total ? "Review every rule before export" : undefined}
          >
            Export
          </button>
        }
      />

      {total > 0 && (
        <div
          className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={reviewed}
          aria-label="Rules reviewed"
        >
          <div
            className="h-full rounded-full bg-teal transition-all"
            style={{ width: `${(reviewed / total) * 100}%` }}
          />
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy="true">
          <div className="skeleton h-80" />
          <div className="skeleton h-80" />
        </div>
      ) : loadError ? (
        <div className="alert alert-error items-center justify-between" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setLoadError("");
              setLoading(true);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : total === 0 ? (
        <div className="card p-8 text-center text-[13px] text-ink-65">
          No translated rules yet. Translate the project first.
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="glass !rounded-[18px] overflow-hidden">
            <div className="flex justify-between border-b border-line px-4 py-3">
              <b>{total} rules</b>
              <span className="text-ink-65">{total - reviewed} open</span>
            </div>
            <ul className="max-h-[40vh] overflow-y-auto lg:max-h-[calc(100vh-280px)]" aria-label="Rules">
              {withTranslation.map((rule) => {
                const t = rule.translatedRule;
                const decided = t.reviewStatus !== "PENDING";
                const state = ruleState({
                  isOverlyPermissive: rule.isOverlyPermissive,
                  riskScore: rule.riskScore,
                  warnings: t.warnings,
                  analysisNotes: rule.analysisNotes,
                });
                const badge = decided
                  ? REVIEW_STATUS_BADGE[t.reviewStatus] ?? REVIEW_STATUS_BADGE.PENDING
                  : { cls: RULE_STATE_BADGE[state], label: { risk: "risk", flag: "check", ok: "ok" }[state] };
                const on = rule.id === selectedId;
                return (
                  <li key={rule.id} className="border-b border-line-2 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(rule.id)}
                      aria-current={on ? "true" : undefined}
                      className={`flex w-full items-center justify-between gap-2.5 px-4 py-3 text-left hover:bg-g-bg2 ${on ? "!bg-accent-soft" : ""}`}
                    >
                      <span className="truncate font-mono text-[13px]">
                        {pad(rule.position)} {rule.name}
                      </span>
                      <span className={`badge shrink-0 ${badge.cls}`}>{badge.label.toLowerCase()}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {selected && (
            <RuleDetail
              key={selected.id}
              rule={selected}
              src={src}
              tgt={tgt}
              onReview={reviewRule}
              saving={saving}
              error={saveError}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RuleDetail({
  rule,
  src,
  tgt,
  onReview,
  saving,
  error,
}: {
  rule: Rule;
  src: string;
  tgt: string;
  onReview: (id: string, status: string, extra?: ReviewExtra) => void;
  saving: boolean;
  error: string;
}) {
  const t = rule.translatedRule;
  const canEdit = useCanEdit();
  const [note, setNote] = useState(t.reviewerNote ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.manualOverride ?? t.targetConfig);
  const noteChanged = note.trim() !== (t.reviewerNote ?? "");
  // Send the note only when it changed, so a decision never drops it
  const decide = (status: string) =>
    onReview(rule.id, status, noteChanged ? { reviewerNote: note } : {});
  const warnings = t.warnings ?? [];
  const review = warnings.filter((w) => w.startsWith("REVIEW:"));
  const notes = warnings.filter((w) => !w.startsWith("REVIEW:") && !w.startsWith("AI:"));
  const aiNotes = warnings.filter((w) => w.startsWith("AI:")).map((w) => w.replace(/^AI:\s*/, ""));
  const state = ruleState({
    isOverlyPermissive: rule.isOverlyPermissive,
    riskScore: rule.riskScore,
    warnings,
    analysisNotes: rule.analysisNotes,
  });
  const status = REVIEW_STATUS_BADGE[t.reviewStatus] ?? REVIEW_STATUS_BADGE.PENDING;
  const stateLabel = { risk: "Risky rule", flag: "Needs review", ok: "Clean" }[state];

  return (
    <section className="card grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-5" aria-label={`Rule ${rule.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-all font-mono !text-[15px]">
            {pad(rule.position)} {rule.name}
          </h2>
          <div className="text-[13px] text-ink-65">
            {rule.sourceZone ?? "any"} → {rule.destinationZone ?? "any"} · {rule.action} ·{" "}
            {Math.round(t.confidence * 100)}% confidence
          </div>
        </div>
        <div className="flex gap-2">
          {t.reviewStatus !== "PENDING" && <span className={`badge ${status.cls}`}>{status.label}</span>}
          <span className={`badge ${RULE_STATE_BADGE[state]}`}>{stateLabel}</span>
        </div>
      </div>

      {rule.analysisNotes && (
        <div className={`alert ${state === "risk" ? "alert-error" : "alert-warn"}`}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b className="mr-1">Analysis:</b>
            {rule.analysisNotes.split(" | ").join(" · ")}
          </span>
        </div>
      )}

      {review.map((w, i) => (
        <div key={i} className="alert alert-warn border border-amber/20">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{w.replace(/^REVIEW:\s*/, "")}</span>
        </div>
      ))}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
        <CodeBlock label={`Source · ${src}`} code={sourceText(rule, src)} />
        <CodeBlock label={`Target · ${tgt}`} code={t.targetConfig} />
      </div>

      {t.reviewStatus === "MODIFIED" && t.manualOverride && !editing && (
        <CodeBlock label={`Changed by hand · ${tgt} (exported instead)`} code={t.manualOverride} />
      )}

      {(t.explanation || notes.length > 0) && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Translation notes</span>
            <span className="badge b-grey">deterministic</span>
          </div>
          {t.explanation && <p className="text-[13px] text-ink-65">{t.explanation}</p>}
          {notes.length > 0 && (
            <ul className="grid gap-1 text-xs text-ink-65">
              {notes.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(t.aiExplanation || aiNotes.length > 0) && (
        <aside
          className="grid gap-1.5 rounded-xl border border-dashed border-accent/40 bg-accent-soft px-4 py-3"
          aria-label="AI explanation"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge b-blue">AI</span>
            {t.aiModel && <span className="font-mono text-[11px] text-ink-65">{t.aiModel}</span>}
            <span className="text-[11px] text-ink-45">
              Generated text, may be wrong. It never changes the config.
            </span>
          </div>
          {t.aiExplanation && <p className="text-[13px]">{t.aiExplanation}</p>}
          {aiNotes.length > 0 && (
            <ul className="grid gap-1 text-xs text-ink-65">
              {aiNotes.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {!canEdit ? (
        <>
          {t.reviewerNote && (
            <p className="text-[13px]">
              <b className="mr-1">Reviewer note:</b>
              {t.reviewerNote}
            </p>
          )}
          <ReadOnlyNote action="review rules" />
        </>
      ) : editing ? (
        <div className="grid gap-2">
          <label htmlFor={`edit-${rule.id}`} className="eyebrow">
            Changed config for {tgt} (exported and pushed instead of the generated one)
          </label>
          <textarea
            id={`edit-${rule.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(16, Math.max(6, draft.split("\n").length + 1))}
            className="code"
            spellCheck={false}
          />
          <NoteField id={rule.id} value={note} onChange={setNote} />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(t.manualOverride ?? t.targetConfig);
              }}
              disabled={saving}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onReview(rule.id, "MODIFIED", { manualOverride: draft, reviewerNote: note });
                setEditing(false);
              }}
              disabled={saving || !draft.trim() || draft.trim() === t.targetConfig.trim()}
              title={draft.trim() === t.targetConfig.trim() ? "Change the config first" : undefined}
              className="btn btn-primary btn-sm"
            >
              Save as modified
            </button>
          </div>
        </div>
      ) : (
        <>
          <NoteField id={rule.id} value={note} onChange={setNote} />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => decide("SKIPPED")}
              disabled={saving}
              className="btn btn-ghost btn-sm"
              aria-pressed={t.reviewStatus === "SKIPPED"}
            >
              Skip
            </button>
            <button
              onClick={() => decide("FLAGGED")}
              disabled={saving}
              className="btn btn-danger btn-sm"
              aria-pressed={t.reviewStatus === "FLAGGED"}
            >
              Flag
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={saving}
              className="btn btn-ghost btn-sm"
              aria-pressed={t.reviewStatus === "MODIFIED"}
            >
              Edit
            </button>
            <button
              onClick={() => decide("APPROVED")}
              disabled={saving}
              className="btn btn-primary btn-sm"
              aria-pressed={t.reviewStatus === "APPROVED"}
            >
              Approve
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function NoteField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={`note-${id}`} className="eyebrow">
        Reviewer note (optional, saved with the decision)
      </label>
      <textarea
        id={`note-${id}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Why this rule is flagged, skipped or changed"
        className="input"
      />
    </div>
  );
}
