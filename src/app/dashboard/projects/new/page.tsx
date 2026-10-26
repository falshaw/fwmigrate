"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { VENDOR_LIST, vendorShort } from "@/lib/vendors";
import { PageHeader } from "@/components/ProjectHeader";
import { ReadOnlyNote, useCanEdit } from "@/components/RoleContext";

const vendors = VENDOR_LIST.map((v) => ({ value: v.id, label: v.label }));

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    description: "",
    sourceVendor: "",
    targetVendor: "",
  });
  const canEdit = useCanEdit();
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

  if (!canEdit)
    return (
      <div className="max-w-2xl">
        <PageHeader eyebrow="Projects" title="New migration" />
        <div className="card p-5">
          <ReadOnlyNote action="create a migration" />
        </div>
      </div>
    );

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Projects"
        title="New migration"
        subtitle="Name the project and pick the source and target vendor. Next you drop or paste the source config."
      />

      <form onSubmit={handleSubmit} className="card grid gap-5 p-5 sm:p-6">
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="name" className="mb-1.5 block text-[13px] font-semibold">
            Project name
          </label>
          <input
            id="name"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. DC edge cutover"
            className="input"
            required
          />
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-[13px] font-semibold">
            Description <span className="font-normal text-ink-45">(optional)</span>
          </label>
          <textarea
            id="description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="input"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="source" className="mb-1.5 block text-[13px] font-semibold">
              Source vendor
            </label>
            <select
              id="source"
              value={form.sourceVendor}
              onChange={(e) => setForm({ ...form, sourceVendor: e.target.value })}
              className="input"
              required
            >
              <option value="">Select source…</option>
              {vendors.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="target" className="mb-1.5 block text-[13px] font-semibold">
              Target vendor
            </label>
            <select
              id="target"
              value={form.targetVendor}
              onChange={(e) => setForm({ ...form, targetVendor: e.target.value })}
              className="input"
              required
            >
              <option value="">Select target…</option>
              {vendors.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {form.sourceVendor && form.targetVendor && (
          <div className="flex items-center justify-center gap-3 rounded-xl border border-g-line bg-g-bg py-3 font-mono text-[13px]">
            <span>{vendorShort(form.sourceVendor)}</span>
            <ArrowRight className="h-4 w-4 text-accent" aria-label="to" />
            <span>{vendorShort(form.targetVendor)}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? "Creating…" : "Create project and import config"}
          </button>
        </div>
      </form>
    </div>
  );
}
