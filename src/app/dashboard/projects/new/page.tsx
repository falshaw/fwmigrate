"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const vendors = [
  { value: "PALO_ALTO", label: "Palo Alto Networks" },
  { value: "CISCO_ASA", label: "Cisco ASA" },
  { value: "CISCO_FTD", label: "Cisco FTD" },
  { value: "CHECKPOINT", label: "Check Point" },
  { value: "FORTINET", label: "Fortinet" },
  { value: "JUNIPER_SRX", label: "Juniper SRX" },
  { value: "SOPHOS", label: "Sophos XG/SFOS" },
  { value: "SONICWALL", label: "SonicWall" },
  { value: "WATCHGUARD", label: "WatchGuard Firebox" },
  { value: "PFSENSE", label: "pfSense" },
  { value: "MIKROTIK", label: "MikroTik RouterOS" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    description: "",
    sourceVendor: "",
    targetVendor: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create project");
      setLoading(false);
      return;
    }

    const data = await res.json();
    router.push(`/dashboard/projects/${data.id}/import`);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-8">
        New Migration Project
      </h1>

      <form onSubmit={handleSubmit} className="card-luxury p-8 space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-300 mb-1">
            Project Name
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., DC Firewall Migration Phase 1"
            className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:border-orange-500 focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">
            Description (optional)
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:border-orange-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-gray-300 mb-1">
              Source Vendor
            </label>
            <select
              value={form.sourceVendor}
              onChange={(e) =>
                setForm({ ...form, sourceVendor: e.target.value })
              }
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:border-orange-500 focus:outline-none"
              required
            >
              <option value="" className="bg-gray-900 text-white">
                Select source...
              </option>
              {vendors.map((v) => (
                <option
                  key={v.value}
                  value={v.value}
                  className="bg-gray-900 text-white"
                >
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">
              Target Vendor
            </label>
            <select
              value={form.targetVendor}
              onChange={(e) =>
                setForm({ ...form, targetVendor: e.target.value })
              }
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:border-orange-500 focus:outline-none"
              required
            >
              <option value="" className="bg-gray-900 text-white">
                Select target...
              </option>
              {vendors.map((v) => (
                <option
                  key={v.value}
                  value={v.value}
                  className="bg-gray-900 text-white"
                >
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {form.sourceVendor && form.targetVendor && (
          <div className="text-center py-4">
            <span className="text-lg text-gray-300">
              {vendors.find((v) => v.value === form.sourceVendor)?.label}
            </span>
            <span className="text-2xl text-orange-500 mx-4">→</span>
            <span className="text-lg text-gray-300">
              {vendors.find((v) => v.value === form.targetVendor)?.label}
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-brand w-full disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Project & Import Config"}
        </button>
      </form>
    </div>
  );
}
