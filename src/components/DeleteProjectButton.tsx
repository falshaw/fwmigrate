"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

const nf = new Intl.NumberFormat("en-GB");

/**
 * Delete a project after a confirm dialog. The API deletes the project and,
 * by cascade, its source config, rules, objects, NAT rules, analysis,
 * translations, zone mappings, plan, validations and version history.
 */
export function DeleteProjectButton({
  project,
  variant = "button",
  onDeleted,
}: {
  project: { id: string; name: string; ruleCount?: number };
  variant?: "button" | "icon";
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/v1/projects/${project.id}`, { method: "DELETE" }).catch(
      () => null,
    );
    setBusy(false);
    if (res?.ok) {
      setOpen(false);
      onDeleted();
      return;
    }
    setError(
      res?.status === 403
        ? "Only administrators can delete projects."
        : res?.status === 404
          ? "This project no longer exists."
          : "The project was not deleted. Try again.",
    );
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-45 hover:bg-red-soft hover:text-red focus-visible:text-red"
          aria-label={`Delete project ${project.name}`}
          title="Delete project"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          <Trash2 className="h-4 w-4" aria-hidden /> Delete
        </button>
      )}
      <ConfirmDialog
        open={open}
        title="Delete this project?"
        confirmLabel="Delete project"
        busy={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => {
          setOpen(false);
          setError("");
        }}
      >
        <p>
          <b className="text-ink">{project.name}</b>
          {project.ruleCount ? ` and its ${nf.format(project.ruleCount)} rules` : ""} will be
          removed with the imported config, analysis, translations, review decisions and version
          history. This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}
