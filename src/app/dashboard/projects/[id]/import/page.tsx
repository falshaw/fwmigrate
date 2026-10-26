"use client";

import { useRef, useState, type DragEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileUp, TriangleAlert, CheckCircle2 } from "lucide-react";
import { ProjectHeader, type ProjectSummary } from "@/components/ProjectHeader";
import { vendorShort } from "@/lib/vendors";
import {
  CONFIG_FILE_ACCEPT,
  ConfigFileError,
  readConfigFile,
  type ConfigFile,
} from "@/lib/ui/config-file";
import { ReadOnlyNote, useCanEdit } from "@/components/RoleContext";

export default function ImportPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const canEdit = useCanEdit();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [config, setConfig] = useState("");
  const [loaded, setLoaded] = useState<ConfigFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const f = await readConfigFile(file);
      setLoaded(f);
      setConfig(f.content);
    } catch (e) {
      setLoaded(null);
      setError(e instanceof ConfigFileError ? e.message : "The file could not be read.");
    } finally {
      // Choosing the same file again should load it again
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void loadFile(e.dataTransfer.files?.[0]);
  }

  async function handleImportAndParse() {
    if (!config.trim()) {
      setError("Paste a config or drop a config file first.");
      return;
    }
    setLoading(true);
    setError("");

    // Import (replaces the current config when the project already has one)
    let res = await fetch(`/api/v1/projects/${projectId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawConfig: config, replace: hasConfig }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail || data.error || `Import failed (HTTP ${res.status})`);
      setLoading(false);
      return;
    }

    // Parse
    res = await fetch(`/api/v1/projects/${projectId}/parse`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail || data.error || `Parse failed (HTTP ${res.status})`);
      setLoading(false);
      return;
    }

    router.push(`/dashboard/projects/${projectId}/analysis`);
  }

  const expected = project?.sourceVendor;
  const mismatch = loaded?.vendor && expected && loaded.vendor !== expected;
  const hasConfig = !!project && project.status !== "CREATED";

  return (
    <div>
      <ProjectHeader
        projectId={projectId}
        step="import"
        title="Import source config"
        onLoad={setProject}
      />

      <div className="card grid gap-4 p-5">
        <p className="text-[13px] text-ink-65">
          Drop a config file or paste the configuration below
          {expected ? ` (source: ${vendorShort(expected)})` : ""}. Supports show running-config,
          XML exports, set commands and JSON exports.
        </p>

        <div
          className={`dropzone flex flex-col items-center gap-3 px-4 py-5 text-center sm:flex-row sm:text-left ${dragging ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-g-line bg-g-bg text-accent"
            aria-hidden
          >
            <FileUp className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <b className="block">Drop a config file here</b>
            <span id="config-file-hint" className="text-xs text-ink-65">
              .txt, .conf, .cfg, .set, .xml or .json, up to 20 MB
            </span>
          </div>
          <label htmlFor="config-file" className="btn btn-ghost btn-sm cursor-pointer">
            Choose file
          </label>
          <input
            ref={fileInput}
            id="config-file"
            type="file"
            accept={CONFIG_FILE_ACCEPT}
            aria-describedby="config-file-hint"
            className="sr-only"
            onChange={(e) => void loadFile(e.target.files?.[0])}
          />
        </div>

        {loaded && !mismatch && (
          <div className="alert alert-ok" role="status">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Loaded <b>{loaded.name}</b>
              {loaded.vendor
                ? `: looks like ${vendorShort(loaded.vendor)}.`
                : ": format not recognised, the parser will try it as the project's source vendor."}
            </span>
          </div>
        )}
        {loaded && mismatch && (
          <div className="alert alert-warn" role="status">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b>{loaded.name}</b> looks like {vendorShort(loaded.vendor!)}, but this
              project&apos;s source is {vendorShort(expected!)}. The import will be refused; choose
              the right file, or create a project with that source vendor.
            </span>
          </div>
        )}

        {hasConfig && (
          <div className="alert alert-warn" role="status">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              This project already has a config. Importing a new one replaces it and discards
              the analysis, translation and review decisions. Zone mappings are kept.
            </span>
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <label htmlFor="config" className="sr-only">
          Source configuration
        </label>
        <textarea
          id="config"
          value={config}
          onChange={(e) => {
            setConfig(e.target.value);
            if (loaded) setLoaded(null);
          }}
          rows={20}
          spellCheck={false}
          placeholder="# or paste your firewall config here"
          className="code"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-xs text-ink-45">
            {config ? config.split("\n").length : 0} lines
          </span>
          {canEdit ? (
            <button onClick={handleImportAndParse} disabled={loading} className="btn btn-primary">
              {loading
                ? "Importing and parsing…"
                : hasConfig
                  ? "Replace config and parse"
                  : "Import and parse"}
            </button>
          ) : (
            <ReadOnlyNote action="import a config" />
          )}
        </div>
      </div>
    </div>
  );
}
