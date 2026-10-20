"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface NormalizedRuleWithTranslation {
  id: string;
  name: string;
  position: number;
  action: string;
  sources: string[];
  destinations: string[];
  services: string[];
  sourceZone?: string;
  destinationZone?: string;
  translatedRule?: {
    id: string;
    targetConfig: string;
    explanation: string;
    warnings?: string[] | null;
    confidence: number;
    reviewStatus: string;
  };
}

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const [rules, setRules] = useState<NormalizedRuleWithTranslation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/projects/${params.id}/rules`)
      .then((r) => r.json())
      .then((data) => {
        setRules(data.rules || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  async function reviewRule(normalizedRuleId: string, status: string) {
    await fetch(`/api/v1/projects/${params.id}/rules/${normalizedRuleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus: status }),
    });
    setRules((prev) =>
      prev.map((r) =>
        r.id === normalizedRuleId
          ? {
              ...r,
              translatedRule: { ...r.translatedRule!, reviewStatus: status },
            }
          : r,
      ),
    );
  }

  const withTranslation = rules.filter((r) => r.translatedRule);
  const reviewed = withTranslation.filter(
    (r) => r.translatedRule!.reviewStatus !== "PENDING",
  ).length;
  const total = withTranslation.length;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Review Translations</h1>
          <p className="text-gray-400 mt-1">
            {reviewed} of {total} rules reviewed
          </p>
        </div>
        <button
          onClick={() => router.push(`/dashboard/projects/${params.id}/export`)}
          className="btn-brand"
          disabled={reviewed < total}
        >
          Export
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-white/10 rounded-full h-2 mb-6">
        <div
          className="bg-orange-500 h-2 rounded-full transition-all"
          style={{ width: `${total > 0 ? (reviewed / total) * 100 : 0}%` }}
        />
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-4">
          {withTranslation.map((rule) => (
            <div
              key={rule.id}
              className={`card-luxury p-5 ${rule.translatedRule!.reviewStatus === "APPROVED" ? "border-green-500/30" : rule.translatedRule!.reviewStatus === "FLAGGED" ? "border-red-500/30" : ""}`}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-medium text-white">
                    #{rule.position} {rule.name}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {rule.action} | {rule.sources.join(", ")} &rarr;{" "}
                    {rule.destinations.join(", ")} | {rule.services.join(", ")}
                  </p>
                </div>
                <span className="text-xs text-gray-500">
                  {Math.round(rule.translatedRule!.confidence * 100)}%
                  confidence
                </span>
              </div>

              <pre className="bg-black/30 p-3 rounded text-green-400 text-xs font-mono overflow-x-auto mb-3">
                {rule.translatedRule!.targetConfig}
              </pre>

              <p className="text-sm text-gray-300 mb-3">
                {rule.translatedRule!.explanation}
              </p>

              {(rule.translatedRule!.warnings ?? []).length > 0 && (
                <ul className="text-xs mb-3 space-y-1">
                  {(rule.translatedRule!.warnings ?? []).map((w, i) => (
                    <li
                      key={i}
                      className={w.startsWith("REVIEW:") ? "text-red-400" : "text-yellow-400/80"}
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => reviewRule(rule.id, "APPROVED")}
                  className={`px-3 py-1 text-sm rounded ${rule.translatedRule!.reviewStatus === "APPROVED" ? "bg-green-500 text-white" : "bg-green-500/10 text-green-400 hover:bg-green-500/20"}`}
                >
                  Approve
                </button>
                <button
                  onClick={() => reviewRule(rule.id, "SKIPPED")}
                  className={`px-3 py-1 text-sm rounded ${rule.translatedRule!.reviewStatus === "SKIPPED" ? "bg-gray-500 text-white" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}
                >
                  Skip
                </button>
                <button
                  onClick={() => reviewRule(rule.id, "FLAGGED")}
                  className={`px-3 py-1 text-sm rounded ${rule.translatedRule!.reviewStatus === "FLAGGED" ? "bg-red-500 text-white" : "bg-red-500/10 text-red-400 hover:bg-red-500/20"}`}
                >
                  Flag
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
