"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
  Wifi,
  WifiOff,
  ExternalLink,
  ArrowRight,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { VENDOR_LIST } from "@/lib/vendors";
import { PageHeader } from "@/components/ProjectHeader";
import { projectStatusBadge } from "@/lib/ui/rules";
import { pushBlockReason } from "@/lib/ui/change-manager";

interface ConnectionStatus {
  configured: boolean;
  apiUrl: string;
  hasApiKey: boolean;
  connection: {
    connected: boolean;
    latencyMs: number;
    version?: string;
    error?: string;
  };
}

interface Project {
  id: string;
  name: string;
  sourceVendor: string;
  targetVendor: string;
  status: string;
  ruleCount: number;
}

interface PushResultItem {
  ruleName: string;
  status: string;
  changeManagerRuleId?: string;
  error?: string;
}

interface PushResult {
  projectId: string;
  projectName: string;
  totalRules: number;
  success: number;
  failed: number;
  results: PushResultItem[];
  changeManagerUrl?: string;
}

const vendorLabels: Record<string, string> = Object.fromEntries(
  VENDOR_LIST.map((v) => [v.id, v.short]),
);

export default function IntegratePage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [pushDescription, setPushDescription] = useState("");
  const [showDescriptionFor, setShowDescriptionFor] = useState<string | null>(
    null,
  );
  const [pushError, setPushError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/integrate/status").then((r) => r.json()),
      fetch("/api/v1/projects").then((r) => r.json()),
    ])
      .then(([statusData, projectsData]) => {
        setStatus(statusData);
        // Translated projects: pushable once every rule is reviewed
        const eligible = (projectsData.projects || []).filter((p: Project) =>
          ["TRANSLATED", "REVIEWING", "APPROVED", "EXPORTED"].includes(p.status),
        );
        setProjects(eligible);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleTestConnection() {
    setTesting(true);
    try {
      const res = await fetch("/api/v1/integrate/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      // ignore
    } finally {
      setTesting(false);
    }
  }

  async function handlePush(projectId: string) {
    setPushing(projectId);
    setPushResult(null);
    setPushError("");
    setShowDescriptionFor(null);
    try {
      const res = await fetch("/api/v1/integrate/change-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          description: pushDescription || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setPushError(data.detail || data.error || "The push failed.");
      } else {
        setPushResult(data);
      }
      setPushDescription("");
    } catch {
      setPushError("The push failed: Change Manager did not answer.");
    } finally {
      setPushing(null);
    }
  }

  if (loading) {
    return (
      <div className="py-20 text-center text-ink-65">
        Loading integration status...
      </div>
    );
  }

  const isConnected = status?.connection?.connected ?? false;
  const changeManagerUrl = status?.apiUrl ?? "";

  return (
    <div>
      <PageHeader
        eyebrow="Tools"
        title="Change manager"
        subtitle="Push migrated rules to Change Manager for the change approval workflow."
      />

      {/* Connection Status */}
      <div className="card p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-accent" />
            <h2 className="!text-base">
              Connection status
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {isConnected && (
              <a
                href={changeManagerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open change manager
              </a>
            )}
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="btn btn-ghost btn-sm"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              Test connection
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-g-line bg-g-bg p-4">
            <p className="eyebrow mb-1">API URL</p>
            <p className="font-mono text-[13px] truncate">
              {status?.apiUrl || "Not configured"}
            </p>
          </div>
          <div className="rounded-xl border border-g-line bg-g-bg p-4">
            <p className="eyebrow mb-1">API key</p>
            <p className="text-[13px]">
              {status?.hasApiKey
                ? "Configured (sent as a bearer token)"
                : "None: requests are sent without authentication"}
            </p>
          </div>
          <div className="rounded-xl border border-g-line bg-g-bg p-4">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <Wifi className="w-4 h-4 text-teal" />
              ) : (
                <WifiOff className="w-4 h-4 text-red" />
              )}
              <div>
                <p className="eyebrow mb-0.5">Status</p>
                <p
                  className={`text-[13px] font-semibold ${isConnected ? "text-teal" : "text-red"}`}
                >
                  {isConnected ? "Connected" : "Disconnected"}
                </p>
              </div>
            </div>
            {status?.apiUrl && status.connection?.latencyMs !== undefined && (
              <p className="text-[11px] text-ink-45 mt-1">
                Latency: {status.connection.latencyMs} ms
                {status.connection.version && ` · version ${status.connection.version}`}
              </p>
            )}
            {status?.connection?.error && (
              <p className="text-[11px] text-red mt-1">
                {status.connection.error}
              </p>
            )}
          </div>
        </div>

        {!isConnected && (
          <div className="alert alert-warn mt-4">
            <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold">
                Change Manager is not reachable
              </p>
              <p className="text-xs text-ink-65 mt-0.5">
                Set <code className="font-mono">CHANGE_MANAGER_API_URL</code>{" "}
                and optionally{" "}
                <code className="font-mono">CHANGE_MANAGER_API_KEY</code> in
                your .env file, then recreate the app container. Any system with{" "}
                <code className="font-mono">GET /api/health</code> and{" "}
                <code className="font-mono">POST /api/rules/import</code> works.
              </p>
            </div>
          </div>
        )}
      </div>

      {pushError && (
        <div className="alert alert-error mb-4" role="alert">
          {pushError}
        </div>
      )}

      {/* Push Results */}
      {pushResult && (
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Send className="w-5 h-5 text-accent" />
            <h3 className="!text-sm font-semibold">
              Push results: {pushResult.projectName}
            </h3>
            <span className="ml-auto text-xs text-ink-65">
              {pushResult.success}/{pushResult.totalRules} rules pushed
              successfully
            </span>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-xl border border-g-line bg-g-bg p-2.5 text-center">
              <div className="text-lg font-bold text-accent">
                {pushResult.totalRules}
              </div>
              <div className="text-[11px] text-ink-65">Total</div>
            </div>
            <div className="rounded-xl border border-g-line bg-g-bg p-2.5 text-center">
              <div className="text-lg font-bold text-teal">
                {pushResult.success}
              </div>
              <div className="text-[11px] text-ink-65">Pushed</div>
            </div>
            <div className="rounded-xl border border-g-line bg-g-bg p-2.5 text-center">
              <div className="text-lg font-bold text-red">
                {pushResult.failed}
              </div>
              <div className="text-[11px] text-ink-65">Failed</div>
            </div>
          </div>

          {/* Change Manager link */}
          {pushResult.success > 0 && pushResult.changeManagerUrl && (
            <div className="alert alert-ok mb-4 items-center">
              <Shield className="w-4 h-4 text-teal" />
              <p className="text-[13px] flex-1">
                {pushResult.success} rule
                {pushResult.success !== 1 ? "s" : ""} sent to Change Manager approval
                queue
              </p>
              <a
                href={`${pushResult.changeManagerUrl}/requests`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-semibold hover:underline"
              >
                View in Change Manager <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {pushResult.results.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-xl border border-g-line bg-g-bg px-3 py-2"
              >
                {r.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-teal shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red shrink-0" />
                )}
                <span className="font-mono text-xs flex-1 truncate">
                  {r.ruleName}
                </span>
                {r.changeManagerRuleId && (
                  <span className="text-[11px] text-ink-65 shrink-0">
                    ID: {r.changeManagerRuleId}
                  </span>
                )}
                {r.error && (
                  <span className="text-[11px] text-red truncate max-w-[250px] shrink-0">
                    {r.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Eligible Projects */}
      <div className="card p-5">
        <h2 className="!text-base mb-4">
          Translated projects
        </h2>

        {projects.length === 0 ? (
          <div className="text-center py-8">
            <Send className="w-8 h-8 text-ink-45 mx-auto mb-2" />
            <p className="text-[13px] text-ink-65">
              No translated projects yet. Translate a project, review its rules, then push them here.
            </p>
            <Link
              href="/dashboard/projects"
              className="text-xs font-semibold text-accent hover:underline mt-2 inline-flex items-center gap-1"
            >
              Go to projects <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => {
              const blocked = pushBlockReason(project.status, status);
              const canPush = !blocked;
              const reasonId = `push-reason-${project.id}`;

              return (
                <div
                  key={project.id}
                  className="rounded-xl border border-g-line bg-g-bg"
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">
                        {project.name}
                      </p>
                      <p className="text-xs text-ink-65">
                        {vendorLabels[project.sourceVendor] ||
                          project.sourceVendor}{" "}
                        {"\u2192"}{" "}
                        {vendorLabels[project.targetVendor] ||
                          project.targetVendor}{" "}
                        | {project.ruleCount} rules
                      </p>
                    </div>
                    <span
                      className={`badge shrink-0 ${projectStatusBadge(project.status).cls}`}
                    >
                      {projectStatusBadge(project.status).label}
                    </span>

                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                      {showDescriptionFor !== project.id && (
                        <>
                          {blocked && (
                            <span id={reasonId} className="min-w-0 text-[11px] text-amber">
                              {blocked}
                            </span>
                          )}
                          <button
                            onClick={() => {
                              if (canPush) {
                                setShowDescriptionFor(project.id);
                              }
                            }}
                            disabled={pushing === project.id || !canPush}
                            aria-describedby={blocked ? reasonId : undefined}
                            className="btn btn-primary btn-sm"
                          >
                            {pushing === project.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            Push to Change Manager
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Description input */}
                  {showDescriptionFor === project.id && (
                    <div className="px-4 pb-3 border-t border-line-2 pt-3">
                      <label
                        htmlFor={`push-desc-${project.id}`}
                        className="mb-1.5 block text-[13px] font-semibold"
                      >
                        Change description (optional)
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <input
                          id={`push-desc-${project.id}`}
                          type="text"
                          value={pushDescription}
                          onChange={(e) => setPushDescription(e.target.value)}
                          placeholder="e.g., Data center firewall migration — Phase 1"
                          className="input flex-1"
                        />
                        <button
                          onClick={() => setShowDescriptionFor(null)}
                          className="btn btn-ghost btn-sm"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handlePush(project.id)}
                          disabled={pushing === project.id}
                          className="btn btn-primary btn-sm"
                        >
                          {pushing === project.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          Push
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
