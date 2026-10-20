"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  Link2,
  Settings,
  Wifi,
  WifiOff,
  ExternalLink,
  ArrowRight,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { VENDOR_LIST } from "@/lib/vendors";

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
  VENDOR_LIST.map((v) => [v.id, v.label]),
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

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/integrate/status").then((r) => r.json()),
      fetch("/api/v1/projects").then((r) => r.json()),
    ])
      .then(([statusData, projectsData]) => {
        setStatus(statusData);
        // Filter to translated/approved/exported projects
        const eligible = (projectsData.projects || []).filter(
          (p: Project) =>
            p.status === "APPROVED" ||
            p.status === "EXPORTED" ||
            p.status === "TRANSLATED",
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
      const data = await res.json();
      if (data.error) {
        alert(data.detail || data.error);
      } else {
        setPushResult(data);
      }
      setPushDescription("");
    } catch {
      alert("Failed to push to Change Manager");
    } finally {
      setPushing(null);
    }
  }

  if (loading) {
    return (
      <div className="text-gray-400 py-20 text-center">
        Loading integration status...
      </div>
    );
  }

  const isConnected = status?.connection?.connected ?? false;
  const changeManagerUrl = status?.apiUrl || "http://localhost:3003";

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link2 className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">
            Change Manager Integration
          </h1>
          <p className="text-sm text-gray-400">
            Push migrated rules to Change Manager for change approval workflow
          </p>
        </div>
      </div>

      {/* Connection Status */}
      <div className="card-luxury p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">
              Connection Status
            </h2>
          </div>
          <div className="flex gap-2">
            {isConnected && (
              <a
                href={changeManagerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/30 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open Change Manager
              </a>
            )}
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-medium hover:bg-blue-500/30 transition disabled:opacity-40"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              Test Connection
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">API URL</p>
            <p className="text-sm text-white font-mono truncate">
              {status?.apiUrl || "Not configured"}
            </p>
          </div>
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">API Key</p>
            <p className="text-sm text-white">
              {status?.hasApiKey ? "Configured" : "Not set (using open access)"}
            </p>
          </div>
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <Wifi className="w-4 h-4 text-green-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-400" />
              )}
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Status</p>
                <p
                  className={`text-sm font-medium ${isConnected ? "text-green-400" : "text-red-400"}`}
                >
                  {isConnected ? "Connected" : "Disconnected"}
                </p>
              </div>
            </div>
            {status?.connection?.latencyMs !== undefined && (
              <p className="text-[10px] text-gray-500 mt-1">
                Latency: {status.connection.latencyMs}ms
                {status.connection.version &&
                  ` | v${status.connection.version}`}
              </p>
            )}
            {status?.connection?.error && (
              <p className="text-[10px] text-red-400 mt-1">
                {status.connection.error}
              </p>
            )}
          </div>
        </div>

        {!isConnected && (
          <div className="mt-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-yellow-400">
                Change Manager is not reachable
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Set <code className="text-yellow-400/80">CHANGE_MANAGER_API_URL</code>{" "}
                and optionally{" "}
                <code className="text-yellow-400/80">CHANGE_MANAGER_API_KEY</code> in
                your .env file. Default: http://localhost:3003
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Push Results */}
      {pushResult && (
        <div className="card-luxury p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Send className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">
              Push Results: {pushResult.projectName}
            </h3>
            <span className="ml-auto text-xs text-gray-400">
              {pushResult.success}/{pushResult.totalRules} rules pushed
              successfully
            </span>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold text-blue-400">
                {pushResult.totalRules}
              </div>
              <div className="text-[10px] text-gray-400">Total</div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold text-green-400">
                {pushResult.success}
              </div>
              <div className="text-[10px] text-gray-400">Pushed</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold text-red-400">
                {pushResult.failed}
              </div>
              <div className="text-[10px] text-gray-400">Failed</div>
            </div>
          </div>

          {/* Change Manager link */}
          {pushResult.success > 0 && pushResult.changeManagerUrl && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" />
              <p className="text-sm text-green-400 flex-1">
                {pushResult.success} rule
                {pushResult.success !== 1 ? "s" : ""} sent to Change Manager approval
                queue
              </p>
              <a
                href={`${pushResult.changeManagerUrl}/requests`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-green-400 hover:underline"
              >
                View in Change Manager <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

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
                <span className="text-xs text-white flex-1 truncate">
                  {r.ruleName}
                </span>
                {r.changeManagerRuleId && (
                  <span className="text-[10px] text-gray-400 shrink-0">
                    ID: {r.changeManagerRuleId}
                  </span>
                )}
                {r.error && (
                  <span className="text-[10px] text-red-400 truncate max-w-[250px] shrink-0">
                    {r.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Eligible Projects */}
      <div className="card-luxury p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Projects Ready for Push
        </h2>

        {projects.length === 0 ? (
          <div className="text-center py-8">
            <Send className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              No projects ready. Translate and approve rules in a project first.
            </p>
            <Link
              href="/dashboard"
              className="text-xs text-blue-400 hover:underline mt-2 inline-flex items-center gap-1"
            >
              Go to Projects <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => {
              const isTranslatedOnly = project.status === "TRANSLATED";
              const canPush = isConnected && !isTranslatedOnly;

              return (
                <div
                  key={project.id}
                  className="bg-white/[0.03] border border-white/10 rounded-lg"
                >
                  <div className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {project.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {vendorLabels[project.sourceVendor] ||
                          project.sourceVendor}{" "}
                        {"\u2192"}{" "}
                        {vendorLabels[project.targetVendor] ||
                          project.targetVendor}{" "}
                        | {project.ruleCount} rules
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                        project.status === "APPROVED"
                          ? "bg-green-500/10 text-green-400"
                          : project.status === "EXPORTED"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-orange-500/10 text-orange-400"
                      }`}
                    >
                      {project.status}
                    </span>

                    <div className="flex items-center gap-2 shrink-0">
                      {showDescriptionFor !== project.id && (
                        <>
                          {isTranslatedOnly && (
                            <span className="text-[10px] text-yellow-400">
                              Approve rules first
                            </span>
                          )}
                          <button
                            onClick={() => {
                              if (canPush) {
                                setShowDescriptionFor(project.id);
                              }
                            }}
                            disabled={pushing === project.id || !canPush}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 text-sm font-medium hover:bg-blue-500/30 transition disabled:opacity-40"
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
                    <div className="px-4 pb-3 border-t border-white/5 pt-3">
                      <label className="text-xs text-gray-500 mb-1 block">
                        Change Description (optional)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={pushDescription}
                          onChange={(e) => setPushDescription(e.target.value)}
                          placeholder="e.g., Data center firewall migration — Phase 1"
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500/50 focus:outline-none"
                        />
                        <button
                          onClick={() => setShowDescriptionFor(null)}
                          className="px-3 py-2 text-sm text-gray-400 hover:text-white transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handlePush(project.id)}
                          disabled={pushing === project.id}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 text-sm font-medium hover:bg-blue-500/30 transition disabled:opacity-40"
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
