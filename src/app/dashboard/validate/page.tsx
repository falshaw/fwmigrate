"use client";

import { useEffect, useState } from "react";
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

const vendorOptions = [
  { value: "PALO_ALTO", label: "Palo Alto" },
  { value: "CISCO_ASA", label: "Cisco ASA" },
  { value: "CISCO_FTD", label: "Cisco FTD" },
  { value: "CHECKPOINT", label: "Check Point" },
  { value: "FORTINET", label: "Fortinet" },
  { value: "JUNIPER_SRX", label: "Juniper SRX" },
  { value: "SOPHOS", label: "Sophos" },
  { value: "SONICWALL", label: "SonicWall" },
  { value: "WATCHGUARD", label: "WatchGuard" },
  { value: "PFSENSE", label: "pfSense" },
  { value: "MIKROTIK", label: "MikroTik" },
];

const vendorLabels: Record<string, string> = Object.fromEntries(
  vendorOptions.map((v) => [v.value, v.label]),
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
  const [tab, setTab] = useState<TabMode>("raw");

  // Raw config validation state
  const [config, setConfig] = useState("");
  const [vendor, setVendor] = useState("PALO_ALTO");
  const [validating, setValidating] = useState(false);
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
      setLoadingProjects(true);
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
    try {
      const res = await fetch("/api/v1/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, vendor }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      alert("Validation request failed");
    } finally {
      setValidating(false);
    }
  }

  async function handleValidateProject() {
    if (!selectedProject) return;
    setValidatingProject(true);
    setProjectResult(null);
    try {
      const res = await fetch(`/api/v1/validate/${selectedProject}`, {
        method: "POST",
      });
      const data = await res.json();
      setProjectResult(data);
      // Refresh history
      const histRes = await fetch(`/api/v1/validate/${selectedProject}`);
      const histData = await histRes.json();
      setValidationHistory(histData.results || []);
    } catch {
      alert("Project validation failed");
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
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="w-6 h-6 text-purple-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Config Validation</h1>
          <p className="text-sm text-gray-400">
            Validate firewall configuration syntax before deployment
          </p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-6 bg-white/[0.03] rounded-lg p-1 w-fit">
        <button
          onClick={() => {
            setTab("raw");
            setProjectResult(null);
          }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${
            tab === "raw"
              ? "bg-purple-500/20 text-purple-400"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <FileText className="w-4 h-4 inline mr-1.5" />
          Raw Config
        </button>
        <button
          onClick={() => {
            setTab("project");
            setResult(null);
          }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${
            tab === "project"
              ? "bg-purple-500/20 text-purple-400"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <FolderOpen className="w-4 h-4 inline mr-1.5" />
          Project Validation
        </button>
      </div>

      {/* Raw Config Tab */}
      {tab === "raw" && (
        <div className="card-luxury p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="md:col-span-1">
              <label className="text-xs text-gray-500 mb-1 block">
                Target Vendor
              </label>
              <select
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              >
                {vendorOptions.map((v) => (
                  <option
                    key={v.value}
                    value={v.value}
                    className="bg-[#0d1e36]"
                  >
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">
                Upload Config File
              </label>
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-purple-500/20 file:text-purple-400"
              />
            </div>
            <div className="md:col-span-1 flex items-end">
              <button
                onClick={handleValidateRaw}
                disabled={validating || !config.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 text-sm font-medium hover:bg-purple-500/30 transition disabled:opacity-40"
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

          <textarea
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            placeholder="Paste firewall configuration here..."
            rows={12}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-sm font-mono resize-y focus:border-purple-500/50 focus:outline-none"
          />
          {config && (
            <p className="text-xs text-gray-500 mt-2">
              <FileText className="w-3 h-3 inline mr-1" />
              {config.split("\n").length} lines,{" "}
              {new Blob([config]).size.toLocaleString()} bytes
            </p>
          )}
        </div>
      )}

      {/* Project Validation Tab */}
      {tab === "project" && (
        <div className="card-luxury p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">
                Select Project
              </label>
              {loadingProjects ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading projects...
                </div>
              ) : projects.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">
                  No projects with translated rules available.{" "}
                  <Link
                    href="/dashboard"
                    className="text-purple-400 hover:underline"
                  >
                    Create a project
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <select
                  value={selectedProject}
                  onChange={(e) => {
                    setSelectedProject(e.target.value);
                    setProjectResult(null);
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="" className="bg-[#0d1e36]">
                    Choose a project...
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-[#0d1e36]">
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 text-sm font-medium hover:bg-purple-500/30 transition disabled:opacity-40"
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
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-gray-500" />
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Validation History
                </h3>
              </div>
              <div className="space-y-1.5">
                {validationHistory.slice(0, 5).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-3 px-3 py-2 bg-white/[0.02] rounded-lg"
                  >
                    {v.status === "passed" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span className="text-xs text-gray-400 flex-1">
                      {vendorLabels[v.vendor] || v.vendor}
                    </span>
                    <span className="text-[10px] text-red-400">
                      {v.errorCount} errors
                    </span>
                    <span className="text-[10px] text-yellow-400">
                      {v.warningCount} warnings
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {new Date(v.validatedAt).toLocaleString()}
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
        <div className="card-luxury p-6">
          <div className="flex items-center gap-3 mb-4">
            {activeResult.valid ? (
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            ) : (
              <XCircle className="w-6 h-6 text-red-400" />
            )}
            <div>
              <h2 className="text-lg font-semibold text-white">
                {activeResult.valid ? "Validation Passed" : "Validation Failed"}
              </h2>
              {activeResult.projectName && (
                <p className="text-xs text-gray-400">
                  Project: {activeResult.projectName}
                  {activeResult.rulesValidated !== undefined &&
                    ` — ${activeResult.rulesValidated} rules validated`}
                </p>
              )}
            </div>
            {activeResult.projectId && (
              <Link
                href={`/dashboard/projects/${activeResult.projectId}`}
                className="ml-auto text-xs text-purple-400 hover:underline flex items-center gap-1"
              >
                View Project <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">{errorCount}</div>
              <div className="text-xs text-gray-400">Errors</div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-yellow-400">
                {warningCount}
              </div>
              <div className="text-xs text-gray-400">Warnings</div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-blue-400">{infoCount}</div>
              <div className="text-xs text-gray-400">Info</div>
            </div>
          </div>

          {/* Issues List */}
          {activeResult.issues.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {activeResult.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 px-4 py-3 bg-white/[0.03] rounded-lg border border-white/5"
                >
                  {issue.severity === "error" ? (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  ) : issue.severity === "warning" ? (
                    <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white">{issue.message}</p>
                    <div className="flex gap-3 mt-1">
                      {issue.line && (
                        <span className="text-[10px] text-gray-500">
                          Line {issue.line}
                        </span>
                      )}
                      {issue.rule && (
                        <span className="text-[10px] text-orange-400">
                          Rule: {issue.rule}
                        </span>
                      )}
                    </div>
                    {issue.suggestion && (
                      <p className="text-xs text-gray-400 mt-1 bg-white/[0.03] rounded px-2 py-1">
                        Fix: {issue.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-400">
              No issues found. Configuration syntax is valid for{" "}
              {vendorLabels[activeResult.vendor] || activeResult.vendor}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
