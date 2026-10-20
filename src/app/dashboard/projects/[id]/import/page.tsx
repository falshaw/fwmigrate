"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ImportPage() {
  const params = useParams();
  const router = useRouter();
  const [config, setConfig] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleImportAndParse() {
    if (!config.trim()) {
      setError("Please paste a config");
      return;
    }
    setLoading(true);
    setError("");

    // Import
    let res = await fetch(`/api/v1/projects/${params.id}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawConfig: config }),
    });

    if (!res.ok) {
      setError("Import failed");
      setLoading(false);
      return;
    }

    // Parse
    res = await fetch(`/api/v1/projects/${params.id}/parse`, {
      method: "POST",
    });
    if (!res.ok) {
      setError("Parse failed");
      setLoading(false);
      return;
    }

    router.push(`/dashboard/projects/${params.id}/analysis`);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">
        Import Source Config
      </h1>

      <div className="card-luxury p-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <p className="text-gray-400 mb-4">
          Paste your source firewall configuration below. Supports show
          running-config, XML exports, set commands, and JSON exports.
        </p>

        <textarea
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          rows={20}
          placeholder="Paste your firewall config here..."
          className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-green-400 font-mono text-sm focus:border-orange-500 focus:outline-none mb-4"
        />

        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">
            {config.split("\n").length} lines
          </span>
          <button
            onClick={handleImportAndParse}
            disabled={loading}
            className="btn-brand disabled:opacity-50"
          >
            {loading ? "Importing & Parsing..." : "Import & Parse"}
          </button>
        </div>
      </div>
    </div>
  );
}
