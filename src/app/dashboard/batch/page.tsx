"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Upload,
  Play,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Plus,
  ArrowLeft,
  Trash2,
  FileUp,
  Files,
} from "lucide-react";

interface BatchConfig {
  filename: string;
  rawConfig: string;
  sourceVendor: string;
  targetVendor: string;
}

interface BatchMigration {
  id: string;
  name: string;
  status: string;
  totalConfigs: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
}

interface BatchResult {
  filename: string;
  sourceVendor: string;
  targetVendor: string;
  status: string;
  projectId?: string;
  error?: string;
  ruleCount?: number;
}

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

function detectVendor(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes("config firewall policy") || lower.includes("set srcintf"))
    return "FORTINET";
  if (
    lower.includes("rulebase security rules") ||
    lower.includes("set network")
  )
    return "PALO_ALTO";
  if (lower.includes("access-list") && lower.includes("extended"))
    return "CISCO_ASA";
  if (lower.includes("mgmt_cli")) return "CHECKPOINT";
  if (
    lower.includes("security policies from-zone") ||
    lower.includes("security-zone")
  )
    return "JUNIPER_SRX";
  if (lower.includes("/ip firewall filter")) return "MIKROTIK";
  if (lower.includes("<filterrule")) return "PFSENSE";
  return "PALO_ALTO";
}

export default function BatchMigrationPage() {
  const [batches, setBatches] = useState<BatchMigration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [defaultTarget, setDefaultTarget] = useState("FORTINET");
  const [configs, setConfigs] = useState<BatchConfig[]>([]);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [runProgress, setRunProgress] = useState<number>(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const fetchBatches = useCallback(() => {
    fetch("/api/v1/batch")
      .then((r) => r.json())
      .then((data) => {
        setBatches(data.batches || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  function processFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const detectedVendor = detectVendor(content);
        setConfigs((prev) => [
          ...prev,
          {
            filename: file.name,
            rawConfig: content,
            sourceVendor: detectedVendor,
            targetVendor: defaultTarget,
          },
        ]);
      };
      reader.readAsText(file);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }

  function removeConfig(index: number) {
    setConfigs(configs.filter((_, i) => i !== index));
  }

  function updateConfig(
    index: number,
    field: keyof BatchConfig,
    value: string,
  ) {
    const updated = [...configs];
    updated[index] = { ...updated[index], [field]: value };
    setConfigs(updated);
  }

  function handleFileUpload(index: number, file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const updated = [...configs];
      updated[index] = {
        ...updated[index],
        rawConfig: content,
        filename: file.name,
      };
      setConfigs(updated);
    };
    reader.readAsText(file);
  }

  async function handleCreate() {
    if (!name || configs.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, configs }),
      });
      if (!res.ok) throw new Error("Failed to create batch");
      setShowCreate(false);
      setName("");
      setConfigs([]);
      fetchBatches();
    } catch {
      alert("Failed to create batch migration");
    } finally {
      setCreating(false);
    }
  }

  async function handleRun(batchId: string) {
    setRunning(batchId);
    setResults(null);
    setRunProgress(0);

    // Find the batch to get total count for progress
    const batch = batches.find((b) => b.id === batchId);
    const total = batch?.totalConfigs || 1;

    // Simulate progress until real response comes
    const progressInterval = setInterval(() => {
      setRunProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.max(1, Math.floor((90 - prev) / (total * 2)));
      });
    }, 500);

    try {
      const res = await fetch(`/api/v1/batch/${batchId}/run`, {
        method: "POST",
      });
      clearInterval(progressInterval);
      setRunProgress(100);
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
      }
      fetchBatches();
    } catch {
      clearInterval(progressInterval);
      alert("Failed to run batch migration");
    } finally {
      setTimeout(() => {
        setRunning(null);
        setRunProgress(0);
      }, 1000);
    }
  }

  function handleExport(batchId: string) {
    window.open(`/api/v1/batch/${batchId}/export`, "_blank");
  }

  if (loading) {
    return (
      <div className="text-gray-400 py-20 text-center">Loading batches...</div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/dashboard"
              className="text-gray-400 hover:text-white transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-bold text-white">Batch Migration</h1>
          </div>
          <p className="text-sm text-gray-400">
            Import multiple configs, batch translate, download all results
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" /> New Batch
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="card-luxury p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Create Batch Migration
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Batch Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Q1 2026 Data Center Migration"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-orange-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Default Target Vendor
              </label>
              <select
                value={defaultTarget}
                onChange={(e) => setDefaultTarget(e.target.value)}
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
          </div>

          {/* Drag & Drop Zone */}
          <div
            ref={dropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-8 mb-4 text-center transition-all cursor-pointer ${
              isDragOver
                ? "border-orange-500 bg-orange-500/10"
                : "border-white/10 bg-white/[0.02] hover:border-white/20"
            }`}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.multiple = true;
              input.accept = ".txt,.conf,.cfg,.xml,.json,.log";
              input.onchange = (e) => {
                const files = (e.target as HTMLInputElement).files;
                if (files) processFiles(files);
              };
              input.click();
            }}
          >
            <FileUp
              className={`w-10 h-10 mx-auto mb-3 ${isDragOver ? "text-orange-400" : "text-gray-600"}`}
            />
            <p
              className={`text-sm ${isDragOver ? "text-orange-400" : "text-gray-400"}`}
            >
              {isDragOver
                ? "Drop files here..."
                : "Drag & drop firewall config files here, or click to browse"}
            </p>
            <p className="text-[10px] text-gray-600 mt-1">
              Supports .txt, .conf, .cfg, .xml, .json — source vendor
              auto-detected
            </p>
          </div>

          {/* Config List */}
          {configs.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 flex items-center gap-1.5">
                  <Files className="w-3.5 h-3.5" />
                  {configs.length} config{configs.length !== 1 ? "s" : ""}{" "}
                  loaded
                </span>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {configs.map((config, idx) => (
                  <div
                    key={idx}
                    className="bg-white/[0.03] border border-white/10 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-medium text-white truncate flex-1">
                        {config.filename || `Config #${idx + 1}`}
                      </span>
                      {config.rawConfig && (
                        <span className="text-[10px] text-green-400 shrink-0">
                          {config.rawConfig.split("\n").length} lines
                        </span>
                      )}
                      <button
                        onClick={() => removeConfig(idx)}
                        className="text-red-400 hover:text-red-300 transition shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-600 mb-0.5 block">
                          Source
                        </label>
                        <select
                          value={config.sourceVendor}
                          onChange={(e) =>
                            updateConfig(idx, "sourceVendor", e.target.value)
                          }
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs"
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
                      <div>
                        <label className="text-[10px] text-gray-600 mb-0.5 block">
                          Target
                        </label>
                        <select
                          value={config.targetVendor}
                          onChange={(e) =>
                            updateConfig(idx, "targetVendor", e.target.value)
                          }
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs"
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
                    </div>

                    {!config.rawConfig && (
                      <div className="mt-2">
                        <input
                          type="file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(idx, file);
                          }}
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs file:mr-3 file:py-0.5 file:px-2 file:rounded file:border-0 file:text-xs file:bg-orange-500/20 file:text-orange-400"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual Config Add */}
          <div className="flex gap-3">
            <button
              onClick={() =>
                setConfigs([
                  ...configs,
                  {
                    filename: "",
                    rawConfig: "",
                    sourceVendor: "PALO_ALTO",
                    targetVendor: defaultTarget,
                  },
                ])
              }
              className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300 transition"
            >
              <Upload className="w-4 h-4" /> Add Config Manually
            </button>
            <div className="flex-1" />
            <button
              onClick={() => {
                setShowCreate(false);
                setName("");
                setConfigs([]);
              }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !name || configs.length === 0}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Create Batch ({configs.length} config
              {configs.length !== 1 ? "s" : ""})
            </button>
          </div>
        </div>
      )}

      {/* Results Panel */}
      {results && (
        <div className="card-luxury p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">
            Batch Results
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-green-400">
                {results.filter((r) => r.status === "success").length}
              </div>
              <div className="text-xs text-gray-400">Succeeded</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">
                {results.filter((r) => r.status === "failed").length}
              </div>
              <div className="text-xs text-gray-400">Failed</div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-blue-400">
                {results.reduce((s, r) => s + (r.ruleCount || 0), 0)}
              </div>
              <div className="text-xs text-gray-400">Total Rules</div>
            </div>
          </div>
          <div className="space-y-2">
            {results.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-3 py-2 bg-white/[0.03] rounded-lg"
              >
                {r.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span className="text-sm text-white flex-1 truncate">
                  {r.filename}
                </span>
                <span className="text-xs text-gray-400 shrink-0">
                  {vendorLabels[r.sourceVendor] || r.sourceVendor} →{" "}
                  {vendorLabels[r.targetVendor] || r.targetVendor}
                </span>
                {r.ruleCount !== undefined && (
                  <span className="text-xs text-green-400 shrink-0">
                    {r.ruleCount} rules
                  </span>
                )}
                {r.error && (
                  <span className="text-xs text-red-400 truncate max-w-[200px] shrink-0">
                    {r.error}
                  </span>
                )}
                {r.projectId && (
                  <Link
                    href={`/dashboard/projects/${r.projectId}`}
                    className="text-xs text-orange-400 hover:underline shrink-0"
                  >
                    View
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch List */}
      {batches.length === 0 ? (
        <div className="card-luxury p-12 text-center">
          <Upload className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No batch migrations yet</p>
          <p className="text-gray-600 text-xs mt-1">
            Create a batch to migrate multiple configs at once
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <div key={batch.id} className="card-luxury p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {batch.name}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-400">
                      {batch.totalConfigs} configs
                    </span>
                    {batch.completedCount > 0 && (
                      <span className="text-xs text-green-400">
                        {batch.completedCount} done
                      </span>
                    )}
                    {batch.failedCount > 0 && (
                      <span className="text-xs text-red-400">
                        {batch.failedCount} failed
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <StatusBadge status={batch.status} />

                <div className="flex gap-2">
                  {batch.status === "pending" && (
                    <button
                      onClick={() => handleRun(batch.id)}
                      disabled={running === batch.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/30 transition disabled:opacity-50"
                    >
                      {running === batch.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      Run
                    </button>
                  )}
                  {batch.status === "completed" && (
                    <button
                      onClick={() => handleExport(batch.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 text-xs font-medium hover:bg-orange-500/30 transition"
                    >
                      <Download className="w-3.5 h-3.5" /> Export
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar for running batch */}
              {running === batch.id && runProgress > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                    <span>Processing configs...</span>
                    <span>{runProgress}%</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5">
                    <div
                      className="bg-gradient-to-r from-green-500 to-green-400 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${runProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Completed progress bar */}
              {batch.status === "completed" && batch.totalConfigs > 0 && (
                <div className="mt-3">
                  <div className="w-full bg-white/5 rounded-full h-1">
                    <div className="flex h-1 rounded-full overflow-hidden">
                      <div
                        className="bg-green-500"
                        style={{
                          width: `${(batch.completedCount / batch.totalConfigs) * 100}%`,
                        }}
                      />
                      {batch.failedCount > 0 && (
                        <div
                          className="bg-red-500"
                          style={{
                            width: `${(batch.failedCount / batch.totalConfigs) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: {
      bg: "bg-gray-500/10",
      text: "text-gray-400",
      label: "Pending",
    },
    running: {
      bg: "bg-blue-500/10",
      text: "text-blue-400",
      label: "Running",
    },
    completed: {
      bg: "bg-green-500/10",
      text: "text-green-400",
      label: "Completed",
    },
    failed: { bg: "bg-red-500/10", text: "text-red-400", label: "Failed" },
  };

  const s = config[status] || config.pending;

  return (
    <span
      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.bg} ${s.text}`}
    >
      {status === "running" && <Clock className="w-3 h-3 inline mr-1" />}
      {s.label}
    </span>
  );
}
