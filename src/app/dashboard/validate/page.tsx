"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileText,
  FolderOpen,
  ArrowRight,
  History,
  Info,
} from "lucide-react";
import { VENDOR_LIST } from "@/lib/vendors";
import { PageHeader } from "@/components/ProjectHeader";
import { CONFIG_FILE_ACCEPT } from "@/lib/ui/config-file";
import { LocalTime } from "@/components/LocalTime";

const vendorOptions = VENDOR_LIST.map((v) => ({ value: v.id, label: v.label }));

const vendorLabels: Record<string, string> = Object.fromEntries(
  VENDOR_LIST.map((v) => [v.id, v.short]),
);

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
  totalChecks: number;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  projectId?: string;
  projectName?: string;
  rulesValidated?: number;
}

interface Project {
  id: string;
  name: string;
  sourceVendor: string;
  targetVendor: string;
  status: string;
  ruleCount: number;
}

interface StoredValidation {
  id: string;
  status: string;
  vendor: string;
  totalChecks: number;
  errorCount: number;
  warningCount: number;
  validatedAt: string;
}

type TabMode = "raw" | "project";

export default function ValidatePage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<TabMode>("raw");

  // Raw config validation state
  const [config, setConfig] = useState("");
  const [vendor, setVendor] = useState("PALO_ALTO");
  const [validating, setValidating] = useState(false);
  const [pageError, setPageError] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);

  // Project validation state
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [validatingProject, setValidatingProject] = useState(false);
  const [projectResult, setProjectResult] = useState<ValidationResult | null>(
    null,
  );
  const [validationHistory, setValidationHistory] = useState<
    StoredValidation[]
  >([]);

  // Load projects that have translated rules
  useEffect(() => {
    if (tab === "project") {
      fetch("/api/v1/projects")
        .then((r) => r.json())
        .then((data) => {
          const eligible = (data.projects || []).filter(
            (p: Project) =>
              p.status === "TRANSLATED" ||
              p.status === "REVIEWING" ||
              p.status === "APPROVED" ||
              p.status === "EXPORTED",
          );
          setProjects(eligible);
          setLoadingProjects(false);
        })
        .catch(() => setLoadingProjects(false));
    }
  }, [tab]);

  // Load validation history when project selected
  useEffect(() => {
    if (selectedProject) {
      fetch(`/api/v1/validate/${selectedProject}`)
        .then((r) => r.json())
        .then((data) => {
          setValidationHistory(data.results || []);
        })
        .catch(() => setValidationHistory([]));
    }
  }, [selectedProject]);

  async function handleValidateRaw() {
    if (!config.trim()) return;
    setValidating(true);
    setResult(null);
    setPageError("");
    try {
      const res = await fetch("/api/v1/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, vendor }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || "");
      setResult(data);
    } catch (e) {
      setPageError(
        `Validation could not run${e instanceof Error && e.message ? `: ${e.message}` : "."}`,
      );
    } finally {
      setValidating(false);
    }
  }

  async function handleValidateProject() {
    if (!selectedProject) return;
    setValidatingProject(true);
    setProjectResult(null);
    setPageError("");
    try {
      const res = await fetch(`/api/v1/validate/${selectedProject}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || "");
      setProjectResult(data);
      // Refresh history
      const histRes = await fetch(`/api/v1/validate/${selectedProject}`);
      const histData = await histRes.json();
      setValidationHistory(histData.results || []);
    } catch (e) {
      setPageError(
        `Project validation could not run${e instanceof Error && e.message ? `: ${e.message}` : "."}`,
      );
    } finally {
      setValidatingProject(false);
    }
  }

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      setConfig(e.target?.result as string);
    };
    reader.readAsText(file);
  }

  const activeResult = tab === "raw" ? result : projectResult;
  const errorCount =
    activeResult?.issues.filter((i) => i.severity === "error").length ?? 0;
  const warningCount =
    activeResult?.issues.filter((i) => i.severity === "warning").length ?? 0;
  const infoCount =
    activeResult?.issues.filter((i) => i.severity === "info").length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Tools"
        title="Validation"
        subtitle="Check firewall configuration syntax before deployment."
      />

      {pageError && (
        <div className="alert alert-error mb-4" role="alert">
          {pageError}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="mb-4 flex w-fit gap-1 rounded-full border border-g-line bg-g-bg2 p-1">
        <button
          onClick={() => {
            setTab("raw");
            setProjectResult(null);
          }}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            tab === "raw"
              ? "bg-accent text-white"
              : "text-ink-65 hover:text-ink"
          }`}
        >
          <FileText className="w-4 h-4 inline mr-1.5" />
          Raw config
        </button>
        <button
          onClick={() => {
            // The effect loads the projects whenever the tab changes to project
            if (tab !== "project") setLoadingProjects(true);
            setTab("project");
            setResult(null);
          }}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            tab === "project"
              ? "bg-accent text-white"
              : "text-ink-65 hover:text-ink"
          }`}
        >
          <FolderOpen className="w-4 h-4 inline mr-1.5" />
          Project validation
        </button>
      </div>

      {/* Raw Config Tab */}
      {tab === "raw" && (
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
            <div className="md:col-span-2">
              <label htmlFor="validate-vendor" className="mb-1.5 block text-[13px] font-semibold">
                Vendor
              </label>
              <select
                id="validate-vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="input"
              >
                {vendorOptions.map((v) => (
                  <option
                    key={v.value}
                    value={v.value}
                   
                  >
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="validate-file" className="mb-1.5 block text-[13px] font-semibold">
                Config file
              </label>
              <input
                ref={fileInput}
                id="validate-file"
                type="file"
                accept={CONFIG_FILE_ACCEPT}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                className="input"
              />
            </div>
            <div className="md:col-span-1 flex items-end">
              <button
                onClick={handleValidateRaw}
                disabled={validating || !config.trim()}
                className="btn btn-primary w-full"
              >
                {validating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Validate
              </button>
            </div>
          </div>

          <label htmlFor="validate-config" className="sr-only">
            Configuration to validate
          </label>
          <textarea
            id="validate-config"
            spellCheck={false}
            value={config}
            onChange={(e) => {
              setConfig(e.target.value);
              // The text no longer is the chosen file: stop showing its name
              if (fileInput.current) fileInput.current.value = "";
            }}
            placeholder="Paste firewall configuration here…"
            rows={12}
            className="code"
          />
          {config && (
            <p className="font-mono text-xs text-ink-45 mt-2">
              <FileText className="w-3 h-3 inline mr-1" />
              {config.split("\n").length} lines,{" "}
              {new Blob([config]).size.toLocaleString()} bytes
            </p>
          )}
        </div>
      )}

      {/* Project Validation Tab */}
      {tab === "project" && (
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label htmlFor="validate-project" className="mb-1.5 block text-[13px] font-semibold">
                Project
              </label>
              {loadingProjects ? (
                <div className="flex items-center gap-2 text-ink-65 text-[13px] py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading projects...
                </div>
              ) : projects.length === 0 ? (
                <p className="text-[13px] text-ink-65 py-2">
                  No projects with translated rules available.{" "}
                  <Link
                    href="/dashboard/projects/new"
                    className="font-semibold text-accent hover:underline"
                  >
                    Create a project
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <select
                  id="validate-project"
                  value={selectedProject}
                  onChange={(e) => {
                    setSelectedProject(e.target.value);
                    setProjectResult(null);
                  }}
                  className="input"
                >
                  <option value="">
                    Choose a project...
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({vendorLabels[p.targetVendor] || p.targetVendor}{" "}
                      — {p.ruleCount} rules, {p.status})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="md:col-span-1 flex items-end">
              <button
                onClick={handleValidateProject}
                disabled={validatingProject || !selectedProject}
                className="btn btn-primary w-full"
              >
                {validatingProject ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Validate Project
              </button>
            </div>
          </div>

          {/* Validation History */}
          {selectedProject && validationHistory.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-ink-45" />
                <h3 className="eyebrow">
                  Validation History
                </h3>
              </div>
              <div className="space-y-1.5">
                {validationHistory.slice(0, 5).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-3 rounded-xl border border-g-line bg-g-bg px-3 py-2"
                  >
                    {v.status === "passed" ? (
                      <CheckCircle2 className="w-4 h-4 text-teal shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red shrink-0" />
                    )}
                    <span className="text-xs text-ink-65 flex-1">
                      {vendorLabels[v.vendor] || v.vendor}
                    </span>
                    <span className="text-[11px] text-red">
                      {v.errorCount} errors
                    </span>
                    <span className="text-[11px] text-amber">
                      {v.warningCount} warnings
                    </span>
                    <span className="text-[11px] text-ink-45">
                      <LocalTime iso={v.validatedAt} seconds />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results Section */}
      {activeResult && (
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            {activeResult.valid ? (
              <CheckCircle2 className="w-6 h-6 text-teal" />
            ) : (
              <XCircle className="w-6 h-6 text-red" />
            )}
            <div>
              <h2 className="!text-base">
                {activeResult.valid ? "Validation passed" : "Validation failed"}
              </h2>
              {activeResult.projectName && (
                <p className="text-xs text-ink-65">
                  Project: {activeResult.projectName}
                  {activeResult.rulesValidated !== undefined &&
                    ` — ${activeResult.rulesValidated} rules validated`}
                </p>
              )}
            </div>
            {activeResult.projectId && (
              <Link
                href={`/dashboard/projects/${activeResult.projectId}`}
                className="ml-auto text-xs font-semibold text-accent hover:underline flex items-center gap-1"
              >
                View Project <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="rounded-xl border border-g-line bg-g-bg p-3 text-center">
              <div className="text-xl font-bold text-red">{errorCount}</div>
              <div className="text-xs text-ink-65">Errors</div>
            </div>
            <div className="rounded-xl border border-g-line bg-g-bg p-3 text-center">
              <div className="text-xl font-bold text-amber">
                {warningCount}
              </div>
              <div className="text-xs text-ink-65">Warnings</div>
            </div>
            <div className="rounded-xl border border-g-line bg-g-bg p-3 text-center">
              <div className="text-xl font-bold text-accent">{infoCount}</div>
              <div className="text-xs text-ink-65">Info</div>
            </div>
          </div>

          {/* Issues List */}
          {activeResult.issues.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {activeResult.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-xl border border-g-line bg-g-bg px-4 py-3"
                >
                  {issue.severity === "error" ? (
                    <XCircle className="w-4 h-4 text-red shrink-0 mt-0.5" />
                  ) : issue.severity === "warning" ? (
                    <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px]">{issue.message}</p>
                    <div className="flex gap-3 mt-1">
                      {issue.line && (
                        <span className="text-[11px] text-ink-45">
                          Line {issue.line}
                        </span>
                      )}
                      {issue.rule && (
                        <span className="font-mono text-[11px] text-accent">
                          Rule: {issue.rule}
                        </span>
                      )}
                    </div>
                    {issue.suggestion && (
                      <p className="text-xs text-ink-65 mt-1">
                        Fix: {issue.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-teal">
              No issues found. Configuration syntax is valid for{" "}
              {vendorLabels[activeResult.vendor] || activeResult.vendor}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
