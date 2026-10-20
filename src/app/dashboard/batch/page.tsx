"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Upload,
  Play,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  FileUp,
  Files,
} from "lucide-react";
import { VENDOR_LIST } from "@/lib/vendors";
import { PageHeader } from "@/components/ProjectHeader";

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

const vendorOptions = VENDOR_LIST.map((v) => ({ value: v.id, label: v.label }));

const vendorLabels: Record<string, string> = Object.fromEntries(
  VENDOR_LIST.map((v) => [v.id, v.short]),
);

function detectVendor(content: string): string {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes("config firewall policy") || lower.includes("set srcintf"))
    return "FORTINET";
  if (
    lower.startsWith("<") ||
    lower.includes("rulebase security rules")
  )
    return "PALO_ALTO";
  if (lower.includes("access-list") && lower.includes("extended"))
    return "CISCO_ASA";
  if (
    lower.startsWith("{") &&
    (lower.includes('"objects-dictionary"') || lower.includes('"rulebase"'))
  )
    return "CHECKPOINT";
  if (
    lower.includes("security policies from-zone") ||
    lower.includes("security-zone")
  )
    return "JUNIPER_SRX";
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
      <div className="py-20 text-center text-ink-65">Loading batches...</div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Projects"
        title="Batch migration"
        subtitle="Import several configs, translate them in one run, download all results."
        actions={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn btn-primary btn-sm"
            aria-expanded={showCreate}
          >
            <Plus className="w-4 h-4" aria-hidden /> New batch
          </button>
        }
      />

      {/* Create Form */}
      {showCreate && (
        <div className="card p-5 mb-4">
          <h2 className="!text-base mb-4">
            Create Batch Migration
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold">
                Batch Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Q1 2026 Data Center Migration"
                className="input"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold">
                Default Target Vendor
              </label>
              <select
                value={defaultTarget}
                onChange={(e) => setDefaultTarget(e.target.value)}
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
          </div>

          {/* Drag & Drop Zone */}
          <div
            ref={dropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-8 mb-4 text-center transition-all cursor-pointer ${
              isDragOver
                ? "border-accent bg-accent-soft"
                : "border-line bg-g-bg hover:border-accent/50"
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
              className={`w-10 h-10 mx-auto mb-3 ${isDragOver ? "text-accent" : "text-ink-45"}`}
            />
            <p
              className={`text-[13px] ${isDragOver ? "text-accent" : "text-ink-65"}`}
            >
              {isDragOver
                ? "Drop files here..."
                : "Drag & drop firewall config files here, or click to browse"}
            </p>
            <p className="text-[11px] text-ink-45 mt-1">
              Supports .txt, .conf, .cfg, .xml, .json — source vendor
              auto-detected
            </p>
          </div>

          {/* Config List */}
          {configs.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-ink-65 flex items-center gap-1.5">
                  <Files className="w-3.5 h-3.5" />
                  {configs.length} config{configs.length !== 1 ? "s" : ""}{" "}
                  loaded
                </span>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {configs.map((config, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-g-line bg-g-bg p-3"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-[13px] font-medium truncate flex-1">
                        {config.filename || `Config #${idx + 1}`}
                      </span>
                      {config.rawConfig && (
                        <span className="font-mono text-[11px] text-teal shrink-0">
                          {config.rawConfig.split("\n").length} lines
                        </span>
                      )}
                      <button
                        onClick={() => removeConfig(idx)}
                        className="text-red hover:opacity-75 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-ink-65">
                          Source
                        </label>
                        <select
                          value={config.sourceVendor}
                          onChange={(e) =>
                            updateConfig(idx, "sourceVendor", e.target.value)
                          }
                          className="input !h-9 text-[13px]"
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
                      <div>
                        <label className="mb-1 block text-[11px] text-ink-65">
                          Target
                        </label>
                        <select
                          value={config.targetVendor}
                          onChange={(e) =>
                            updateConfig(idx, "targetVendor", e.target.value)
                          }
                          className="input !h-9 text-[13px]"
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
                    </div>

                    {!config.rawConfig && (
                      <div className="mt-2">
                        <input
                          type="file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(idx, file);
                          }}
                          className="input text-xs"
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
              className="btn btn-ghost btn-sm"
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
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !name || configs.length === 0}
              className="btn btn-primary btn-sm"
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
        <div className="card p-5 mb-4">
          <h3 className="!text-base mb-3">
            Batch Results
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="rounded-xl border border-g-line bg-g-bg p-3 text-center">
              <div className="text-xl font-bold text-teal">
                {results.filter((r) => r.status === "success").length}
              </div>
              <div className="text-xs text-ink-65">Succeeded</div>
            </div>
            <div className="rounded-xl border border-g-line bg-g-bg p-3 text-center">
              <div className="text-xl font-bold text-red">
                {results.filter((r) => r.status === "failed").length}
              </div>
              <div className="text-xs text-ink-65">Failed</div>
            </div>
            <div className="rounded-xl border border-g-line bg-g-bg p-3 text-center">
              <div className="text-xl font-bold text-accent">
                {results.reduce((s, r) => s + (r.ruleCount || 0), 0)}
              </div>
              <div className="text-xs text-ink-65">Total Rules</div>
            </div>
          </div>
          <div className="space-y-2">
            {results.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 rounded-xl border border-g-line bg-g-bg px-3 py-2"
              >
                {r.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-teal shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red shrink-0" />
                )}
                <span className="font-mono text-[13px] flex-1 truncate">
                  {r.filename}
                </span>
                <span className="font-mono text-xs text-ink-65 shrink-0">
                  {vendorLabels[r.sourceVendor] || r.sourceVendor} →{" "}
                  {vendorLabels[r.targetVendor] || r.targetVendor}
                </span>
                {r.ruleCount !== undefined && (
                  <span className="text-xs text-teal shrink-0">
                    {r.ruleCount} rules
                  </span>
                )}
                {r.error && (
                  <span className="text-xs text-red truncate max-w-[200px] shrink-0">
                    {r.error}
                  </span>
                )}
                {r.projectId && (
                  <Link
                    href={`/dashboard/projects/${r.projectId}`}
                    className="text-xs font-semibold text-accent hover:underline shrink-0"
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
        <div className="card p-12 text-center">
          <Upload className="w-10 h-10 text-ink-45 mx-auto mb-3" />
          <p className="text-ink-65 text-[13px]">No batch migrations yet</p>
          <p className="text-ink-45 text-xs mt-1">
            Create a batch to migrate multiple configs at once
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <div key={batch.id} className="card p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">
                    {batch.name}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-ink-65">
                      {batch.totalConfigs} configs
                    </span>
                    {batch.completedCount > 0 && (
                      <span className="text-xs text-teal">
                        {batch.completedCount} done
                      </span>
                    )}
                    {batch.failedCount > 0 && (
                      <span className="text-xs text-red">
                        {batch.failedCount} failed
                      </span>
                    )}
                    <span className="text-xs text-ink-45">
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
                      className="btn btn-primary btn-sm"
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
                      className="btn btn-ghost btn-sm"
                    >
                      <Download className="w-3.5 h-3.5" /> Export
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar for running batch */}
              {running === batch.id && runProgress > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-ink-45 mb-1">
                    <span>Processing configs...</span>
                    <span>{runProgress}%</span>
                  </div>
                  <div className="w-full bg-track rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-teal h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${runProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Completed progress bar */}
              {batch.status === "completed" && batch.totalConfigs > 0 && (
                <div className="mt-3">
                  <div className="w-full bg-track rounded-full h-1 overflow-hidden">
                    <div className="flex h-1 rounded-full overflow-hidden">
                      <div
                        className="bg-teal"
                        style={{
                          width: `${(batch.completedCount / batch.totalConfigs) * 100}%`,
                        }}
                      />
                      {batch.failedCount > 0 && (
                        <div
                          className="bg-red"
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
  const config: Record<string, { cls: string; label: string }> = {
    pending: { cls: "b-grey", label: "Pending" },
    running: { cls: "b-blue", label: "Running" },
    completed: { cls: "b-teal", label: "Completed" },
    failed: { cls: "b-red", label: "Failed" },
  };

  const s = config[status] || config.pending;

  return (
    <span
      className={`badge ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
