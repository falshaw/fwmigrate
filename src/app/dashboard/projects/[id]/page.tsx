"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { VENDOR_LIST } from "@/lib/vendors";

interface Project {
  id: string;
  name: string;
  description?: string;
  sourceVendor: string;
  targetVendor: string;
  status: string;
  ruleCount: number;
  objectCount: number;
  parseConfidence?: number;
  createdAt: string;
}

interface ValidationIssue {
  severity: string;
  line?: number;
  rule?: string;
  message: string;
  suggestion?: string;
}

interface ValidationResult {
  valid: boolean;
  vendor: string;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

interface ChangeManagerResult {
  totalRules: number;
  success: number;
  failed: number;
  results: Array<{
    ruleName: string;
    status: string;
    changeManagerRuleId?: string;
    error?: string;
  }>;
}

const vendorLabels: Record<string, string> = Object.fromEntries(
  VENDOR_LIST.map((v) => [v.id, v.label]),
);

const workflowSteps = [
  { key: "import", label: "Import", statuses: ["CREATED"] },
  {
    key: "analysis",
    label: "Analysis",
    statuses: ["PARSED", "ANALYZING", "ANALYZED"],
  },
  {
    key: "translate",
    label: "Translate",
    statuses: ["ANALYZED", "TRANSLATING", "TRANSLATED"],
  },
  { key: "review", label: "Review", statuses: ["TRANSLATED", "REVIEWING"] },
  { key: "export", label: "Export", statuses: ["APPROVED", "EXPORTED"] },
];

export default function ProjectOverviewPage() {
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<ChangeManagerResult | null>(null);

  useEffect(() => {
    fetch(`/api/v1/projects/${params.id}`)
      .then((r) => r.json())
      .then((data) => setProject(data.project || data));
  }, [params.id]);

  async function handleValidate() {
    if (!project) return;
    setValidating(true);
    setValidation(null);
    try {
      // Fetch the exported config, then validate it
      const exportRes = await fetch(
        `/api/v1/projects/${project.id}/export?type=config`,
      );
      if (!exportRes.ok) {
        alert("Export the config first (approve rules).");
        setValidating(false);
        return;
      }
      const configText = await exportRes.text();

      const valRes = await fetch("/api/v1/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: configText,
          vendor: project.targetVendor,
        }),
      });
      const data = await valRes.json();
      setValidation(data);
    } catch {
      alert("Validation failed");
    } finally {
      setValidating(false);
    }
  }

  async function handlePushToChangeManager() {
    if (!project) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/v1/integrate/change-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      setPushResult(data);
    } catch {
      alert("Failed to push to Change Manager");
    } finally {
      setPushing(false);
    }
  }

  if (!project)
    return <div className="text-gray-400 py-20 text-center">Loading...</div>;

  const currentStepIdx = workflowSteps.findIndex((s) =>
    s.statuses.includes(project.status),
  );

  const canValidate = [
    "TRANSLATED",
    "REVIEWING",
    "APPROVED",
    "EXPORTED",
  ].includes(project.status);
  const canPushChangeManager = ["APPROVED", "EXPORTED"].includes(project.status);

  return (
    <div>
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          <p className="text-gray-400 mt-1">
            {vendorLabels[project.sourceVendor]} →{" "}
            {vendorLabels[project.targetVendor]}
          </p>
        </div>
        <span className="text-sm px-3 py-1 rounded bg-orange-500/20 text-orange-400">
          {project.status}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card-luxury p-4 text-center">
          <div className="text-2xl font-bold text-white">
            {project.ruleCount}
          </div>
          <div className="text-sm text-gray-400">Rules</div>
        </div>
        <div className="card-luxury p-4 text-center">
          <div className="text-2xl font-bold text-white">
            {project.objectCount}
          </div>
          <div className="text-sm text-gray-400">Objects</div>
        </div>
        <div className="card-luxury p-4 text-center">
          <div className="text-2xl font-bold text-white">
            {project.parseConfidence
              ? `${Math.round(project.parseConfidence * 100)}%`
              : "\u2014"}
          </div>
          <div className="text-sm text-gray-400">Confidence</div>
        </div>
      </div>

      {/* Workflow steps */}
      <div className="card-luxury p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Migration Workflow
        </h2>
        <div className="flex gap-2">
          {workflowSteps.map((step, idx) => {
            const isCurrent = idx === currentStepIdx;
            const isDone = idx < currentStepIdx;
            return (
              <Link
                key={step.key}
                href={`/dashboard/projects/${project.id}/${step.key}`}
                className={`flex-1 p-4 rounded-lg text-center transition ${
                  isCurrent
                    ? "bg-orange-500/20 border border-orange-500/50"
                    : isDone
                      ? "bg-green-500/10 border border-green-500/30"
                      : "bg-white/5 border border-white/10 opacity-50"
                }`}
              >
                <div
                  className={`text-sm font-medium ${isCurrent ? "text-orange-400" : isDone ? "text-green-400" : "text-gray-500"}`}
                >
                  {step.label}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Actions: Validate + Change Manager Integration */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* FM-04: Validate Config */}
        <div className="card-luxury p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">
              Config Validation
            </h3>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Validate translated config syntax for{" "}
            {vendorLabels[project.targetVendor]} before export.
          </p>
          <button
            onClick={handleValidate}
            disabled={!canValidate || validating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 text-sm font-medium hover:bg-purple-500/30 transition disabled:opacity-40"
          >
            {validating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            Validate Config
          </button>
        </div>

        {/* FM-07: Change Manager Integration */}
        <div className="card-luxury p-5">
          <div className="flex items-center gap-2 mb-3">
            <Send className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">
              Push to Change Manager
            </h3>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Push approved rules to Change Manager for change approval workflow.
          </p>
          <button
            onClick={handlePushToChangeManager}
            disabled={!canPushChangeManager || pushing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 text-sm font-medium hover:bg-blue-500/30 transition disabled:opacity-40"
          >
            {pushing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Push to Change Manager
          </button>
        </div>
      </div>

      {/* Validation Results */}
      {validation && (
        <div className="card-luxury p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            {validation.valid ? (
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400" />
            )}
            <h3 className="text-sm font-semibold text-white">
              Validation Results — {validation.valid ? "PASSED" : "FAILED"}
            </h3>
            <span className="ml-auto text-xs text-gray-400">
              {validation.errors} errors, {validation.warnings} warnings
            </span>
          </div>
          {validation.issues.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {validation.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 px-3 py-2 bg-white/[0.03] rounded-lg"
                >
                  {issue.severity === "error" ? (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  ) : issue.severity === "warning" ? (
                    <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-white">{issue.message}</p>
                    {issue.line && (
                      <span className="text-[10px] text-gray-500">
                        Line {issue.line}
                      </span>
                    )}
                    {issue.suggestion && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Fix: {issue.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {validation.issues.length === 0 && (
            <p className="text-xs text-green-400">
              No issues found. Config syntax is valid.
            </p>
          )}
        </div>
      )}

      {/* Change Manager Push Results */}
      {pushResult && (
        <div className="card-luxury p-5">
          <div className="flex items-center gap-2 mb-3">
            <Send className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">
              Change Manager Push Results
            </h3>
            <span className="ml-auto text-xs text-gray-400">
              {pushResult.success}/{pushResult.totalRules} rules pushed
            </span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {pushResult.results.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] rounded-lg"
              >
                {r.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span className="text-xs text-white flex-1">{r.ruleName}</span>
                {r.changeManagerRuleId && (
                  <span className="text-[10px] text-gray-400">
                    ID: {r.changeManagerRuleId}
                  </span>
                )}
                {r.error && (
                  <span className="text-[10px] text-red-400 truncate max-w-[250px]">
                    {r.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
