"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCanEdit } from "@/components/RoleContext";
import {
  ShieldCheck,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { vendorShort } from "@/lib/vendors";
import { StepPills } from "@/components/ProjectHeader";
import { projectStatusBadge } from "@/lib/ui/rules";
import { pushBlockReason, type ChangeManagerStatus } from "@/lib/ui/change-manager";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import { ProjectHistory } from "@/components/ProjectHistory";

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
  canDelete?: boolean;
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

export default function ProjectOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState("");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validateError, setValidateError] = useState("");
  const [cm, setCm] = useState<ChangeManagerStatus | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<ChangeManagerResult | null>(null);
  const [pushError, setPushError] = useState("");
  const canEdit = useCanEdit();

  useEffect(() => {
    fetch(`/api/v1/projects/${params.id}`)
      .then(async (r) => {
        if (r.status === 404) throw new Error("This project does not exist or was deleted.");
        if (!r.ok) throw new Error("Could not load the project.");
        return r.json();
      })
      .then((data) => setProject(data.project || data))
      .catch((e: Error) => setLoadError(e.message));
    const off = { configured: false, connection: { connected: false } };
    fetch("/api/v1/integrate/status")
      .then((r) => (r.ok ? r.json() : off))
      .then(setCm)
      .catch(() => setCm(off));
  }, [params.id]);

  async function handleValidate() {
    if (!project) return;
    setValidating(true);
    setValidation(null);
    setValidateError("");
    try {
      // Validates the config the export would produce, without exporting it
      const valRes = await fetch(`/api/v1/validate/${project.id}`, { method: "POST" });
      if (valRes.status === 400) {
        setValidateError("No config to validate yet: translate the project first.");
        setValidating(false);
        return;
      }
      if (!valRes.ok) throw new Error("validate failed");
      const data = await valRes.json();
      setValidation(data);
    } catch {
      setValidateError("Validation could not run. Try again.");
    } finally {
      setValidating(false);
    }
  }

  async function handlePushToChangeManager() {
    if (!project) return;
    setPushing(true);
    setPushResult(null);
    setPushError("");
    try {
      const res = await fetch("/api/v1/integrate/change-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) setPushError(data.detail || data.error || "The push failed.");
      else setPushResult(data);
    } catch {
      setPushError("The push failed: Change Manager did not answer.");
    } finally {
      setPushing(false);
    }
  }

  if (loadError)
    return (
      <div className="card p-8 text-center" role="alert">
        <p className="font-semibold">{loadError}</p>
        <Link href="/dashboard/projects" className="btn btn-ghost btn-sm mt-4">
          Back to projects
        </Link>
      </div>
    );

  if (!project)
    return (
      <div className="grid gap-4" aria-busy="true">
        <div className="skeleton h-16" />
        <div className="skeleton h-28" />
      </div>
    );

  const canValidate = [
    "TRANSLATED",
    "REVIEWING",
    "APPROVED",
    "EXPORTED",
  ].includes(project.status);
  const pushBlocked = canEdit
    ? pushBlockReason(project.status, cm)
    : "Your role is read only: a consultant or admin pushes the rules.";
  const badge = projectStatusBadge(project.status);

  return (
    <div>
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">
            <Link href="/dashboard/projects" className="hover:text-ink">
              Projects
            </Link>
          </div>
          <h1 className="mt-1 !text-[28px] break-words">{project.name}</h1>
          <p className="mt-1 font-mono text-[13px] text-ink-65">
            {vendorShort(project.sourceVendor)} → {vendorShort(project.targetVendor)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
          {project.canDelete && (
            <DeleteProjectButton
              project={project}
              onDeleted={() => {
                router.push("/dashboard/projects");
                router.refresh();
              }}
            />
          )}
        </div>
      </div>

      <StepPills projectId={project.id} status={project.status} />

      <div className="mt-5 mb-4 grid grid-cols-3 gap-3">
        {[
          ["Rules", project.ruleCount],
          ["Objects", project.objectCount],
          [
            "Parse confidence",
            project.parseConfidence
              ? `${Math.round(project.parseConfidence * 100)}%`
              : "—",
          ],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <b className="block text-2xl font-bold tracking-tight">{value}</b>
            <small className="text-xs text-ink-65">{label}</small>
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden />
            <h2>Config validation</h2>
          </div>
          <p className="mb-4 text-[13px] text-ink-65">
            Check the translated config syntax for {vendorShort(project.targetVendor)} before
            export.
          </p>
          <button
            onClick={handleValidate}
            disabled={!canValidate || validating}
            className="btn btn-ghost btn-sm"
          >
            {validating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            )}
            Validate config
          </button>
          {!canValidate && (
            <p className="mt-2 text-xs text-ink-65">Translate the project first.</p>
          )}
          {validateError && (
            <p className="mt-2 text-xs text-red" role="alert">
              {validateError}
            </p>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2">
            <Send className="h-5 w-5 text-teal" aria-hidden />
            <h2>Push to Change Manager</h2>
          </div>
          <p className="mb-4 text-[13px] text-ink-65">
            Send approved rules to Change Manager for the change approval workflow.
          </p>
          <button
            onClick={handlePushToChangeManager}
            disabled={!!pushBlocked || pushing}
            aria-describedby={pushBlocked ? "push-blocked" : undefined}
            className="btn btn-ghost btn-sm"
          >
            {pushing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            Push to Change Manager
          </button>
          {pushBlocked && (
            <p id="push-blocked" className="mt-2 text-xs text-ink-65">
              {pushBlocked}{" "}
              {cm && !cm.connection.connected && (
                <Link href="/dashboard/integrate" className="font-semibold text-accent hover:underline">
                  Connection settings
                </Link>
              )}
            </p>
          )}
          {pushError && (
            <p className="mt-2 text-xs text-red" role="alert">
              {pushError}
            </p>
          )}
        </div>
      </div>

      {validation && (
        <div className="card mb-4 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {validation.valid ? (
              <CheckCircle2 className="h-5 w-5 text-teal" aria-hidden />
            ) : (
              <XCircle className="h-5 w-5 text-red" aria-hidden />
            )}
            <h2>Validation {validation.valid ? "passed" : "failed"}</h2>
            <span className="ml-auto text-xs text-ink-65">
              {validation.errors} errors, {validation.warnings} warnings
            </span>
          </div>
          {validation.issues.length > 0 ? (
            <ul className="grid max-h-64 gap-2 overflow-y-auto">
              {validation.issues.map((issue, idx) => (
                <IssueRow key={idx} issue={issue} />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-teal">No issues found. Config syntax is valid.</p>
          )}
        </div>
      )}

      {pushResult && (
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Send className="h-5 w-5 text-teal" aria-hidden />
            <h2>Change Manager push</h2>
            <span className="ml-auto text-xs text-ink-65">
              {pushResult.success}/{pushResult.totalRules} rules pushed
            </span>
          </div>
          <ul className="grid max-h-64 gap-2 overflow-y-auto">
            {pushResult.results.map((r, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 rounded-xl border border-g-line bg-g-bg px-3 py-2"
              >
                {r.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" aria-hidden />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-red" aria-hidden />
                )}
                <span className="flex-1 truncate font-mono text-xs">{r.ruleName}</span>
                {r.changeManagerRuleId && (
                  <span className="text-[11px] text-ink-65">ID: {r.changeManagerRuleId}</span>
                )}
                {r.error && (
                  <span className="max-w-[250px] truncate text-[11px] text-red">{r.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ProjectHistory projectId={project.id} refreshKey={project.status} />
    </div>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  return (
    <li className="flex items-start gap-2.5 rounded-xl border border-g-line bg-g-bg px-3 py-2.5">
      {issue.severity === "error" ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red" aria-label="Error" />
      ) : issue.severity === "warning" ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-label="Warning" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-label="Info" />
      )}
      <div className="min-w-0 text-[13px]">
        <p>{issue.message}</p>
        {issue.line && <span className="font-mono text-[11px] text-ink-45">Line {issue.line}</span>}
        {issue.suggestion && (
          <p className="mt-0.5 text-xs text-ink-65">Fix: {issue.suggestion}</p>
        )}
      </div>
    </li>
  );
}
