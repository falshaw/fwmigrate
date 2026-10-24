"use client";

import { useEffect, useState } from "react";
import { VENDORS, vendorShort, type FirewallVendor } from "@/lib/vendors";

interface ZoneMapping {
  sourceZone: string;
  targetZone: string;
}

/**
 * Maps every zone the source rules use to the target's interface or zone name.
 * Without a mapping the source name is used as is, which only works when the
 * target has an interface or zone with exactly that name.
 */
export function ZoneMappingCard({
  projectId,
  sourceVendor,
  targetVendor,
  onSaved,
}: {
  projectId: string;
  sourceVendor: string;
  targetVendor: string;
  onSaved?: () => void;
}) {
  const [zones, setZones] = useState<string[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/projects/${projectId}/zones`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { zoneMappings: ZoneMapping[]; sourceZones: string[] }) => {
        if (!alive) return;
        const v: Record<string, string> = {};
        for (const z of d.sourceZones) v[z] = z;
        for (const m of d.zoneMappings) v[m.sourceZone] = m.targetZone;
        setZones(d.sourceZones);
        setValues(v);
      })
      .catch(() => alive && setError("Could not load the zones of this project."));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function save() {
    if (!zones) return;
    const empty = zones.find((z) => !values[z]?.trim());
    if (empty) {
      setError(`Enter a target name for ${empty}.`);
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/v1/projects/${projectId}/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mappings: zones.map((z) => ({ sourceZone: z, targetZone: values[z].trim(), isConfirmed: true })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not save the zone mappings.");
      return;
    }
    setSaved(true);
    onSaved?.();
  }

  const term = VENDORS[targetVendor as FirewallVendor]?.zoneTerm ?? "zone";

  if (zones === null && !error) return null;

  return (
    <section className="card mb-4 grid max-w-3xl gap-4 p-5 sm:p-6" aria-labelledby="zone-map-title">
      <div>
        <h2 id="zone-map-title" className="text-[15px] font-semibold">
          Zone mapping
        </h2>
        <p className="mt-1 text-[13px] text-ink-65">
          Every {vendorShort(sourceVendor)} zone the rules use, and the {vendorShort(targetVendor)}{" "}
          {term} it becomes. The source name is kept until you change it; the target must then
          have exactly that name.
        </p>
      </div>

      {zones && zones.length === 0 && (
        <p className="text-[13px] text-ink-65">The rules use no zones (only any).</p>
      )}

      {zones && zones.length > 0 && (
        <div className="grid gap-2">
          {zones.map((z) => (
            <div key={z} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] sm:gap-3">
              <span className="truncate font-mono text-[13px]" title={z}>
                {z}
              </span>
              <span className="hidden text-ink-45 sm:inline" aria-hidden>
                →
              </span>
              <label className="sr-only" htmlFor={`zone-${z}`}>
                {vendorShort(targetVendor)} {term} for {z}
              </label>
              <input
                id={`zone-${z}`}
                className="input font-mono"
                value={values[z] ?? ""}
                maxLength={63}
                onChange={(e) => {
                  setValues({ ...values, [z]: e.target.value });
                  setSaved(false);
                }}
              />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {zones && zones.length > 0 && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="btn btn-ghost btn-sm">
            {saving ? "Saving…" : "Save zone mapping"}
          </button>
          {saved && (
            <span className="text-xs text-ink-65" role="status">
              Saved
            </span>
          )}
        </div>
      )}
    </section>
  );
}
