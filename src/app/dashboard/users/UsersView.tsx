"use client";

import { useEffect, useState } from "react";
import { Plus, Lock, Unlock } from "lucide-react";
import { PageHeader } from "@/components/ProjectHeader";
import { LocalTime } from "@/components/LocalTime";

type Role = "ADMIN" | "CONSULTANT" | "VIEWER";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  locked: boolean;
}

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "ADMIN", label: "Admin", hint: "everything, plus users and project delete" },
  { value: "CONSULTANT", label: "Consultant", hint: "imports, translates, reviews, exports, pushes" },
  { value: "VIEWER", label: "Viewer", hint: "reads and validates only" },
];

const EMPTY = { email: "", name: "", role: "CONSULTANT" as Role, password: "" };

/** The API answers with { error } or a problem+json { detail }. */
async function errorText(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  const zod = Array.isArray(data.details) ? data.details.map((d: { message: string }) => d.message).join(", ") : "";
  return data.detail || zod || data.error || fallback;
}

export function UsersView({ myId }: { myId: string }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setUsers(data.users))
      .catch(() => setLoadError("Could not load the users."));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, name: form.name || undefined }),
    }).catch(() => null);
    setCreating(false);
    if (!res?.ok) {
      setError(res ? await errorText(res, "The user was not created.") : "The user was not created.");
      return;
    }
    const created: User = await res.json();
    setUsers((u) => [...(u ?? []), created]);
    setForm(EMPTY);
    setShowCreate(false);
    setNotice(`${created.email} can now sign in.`);
  }

  async function update(user: User, change: Record<string, unknown>, done?: string) {
    setBusy(user.id);
    setError("");
    setNotice("");
    const res = await fetch(`/api/v1/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError(res ? await errorText(res, "The change was not saved.") : "The change was not saved.");
      return false;
    }
    const saved: User = await res.json();
    setUsers((list) => (list ?? []).map((u) => (u.id === saved.id ? saved : u)));
    if (done) setNotice(done);
    return true;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Tools"
        title="Users"
        subtitle="Who can sign in to this organisation, and what they may do."
        actions={
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="btn btn-primary btn-sm"
            aria-expanded={showCreate}
          >
            <Plus className="h-4 w-4" aria-hidden /> New user
          </button>
        }
      />

      <ul className="mb-4 grid gap-1 text-[13px] text-ink-65">
        {ROLES.map((r) => (
          <li key={r.value}>
            <b className="text-ink">{r.label}</b>: {r.hint}
          </li>
        ))}
      </ul>

      {error && (
        <div className="alert alert-error mb-4" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert alert-ok mb-4" role="status">
          {notice}
        </div>
      )}

      {showCreate && (
        <form onSubmit={create} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label htmlFor="u-email" className="mb-1.5 block text-[13px] font-semibold">
              Email
            </label>
            <input
              id="u-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="input"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="u-name" className="mb-1.5 block text-[13px] font-semibold">
              Name <span className="font-normal text-ink-45">(optional)</span>
            </label>
            <input
              id="u-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              maxLength={100}
            />
          </div>
          <div>
            <label htmlFor="u-role" className="mb-1.5 block text-[13px] font-semibold">
              Role
            </label>
            <select
              id="u-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              className="input"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="u-password" className="mb-1.5 block text-[13px] font-semibold">
              Password <span className="font-normal text-ink-45">(12+ characters; tell the user)</span>
            </label>
            <input
              id="u-password"
              type="password"
              required
              minLength={12}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="input"
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button type="submit" disabled={creating} className="btn btn-primary btn-sm">
              {creating ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      )}

      {loadError ? (
        <div className="alert alert-error" role="alert">
          {loadError}
        </div>
      ) : !users ? (
        <div className="skeleton h-40" aria-busy="true" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Last sign-in</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="max-w-[200px]">
                    <div className="truncate font-semibold">{u.name || u.email}</div>
                    {u.name && <div className="truncate text-xs text-ink-65">{u.email}</div>}
                    {u.id === myId && <div className="text-xs text-ink-45">you</div>}
                  </td>
                  <td>
                    <label htmlFor={`role-${u.id}`} className="sr-only">
                      Role of {u.email}
                    </label>
                    <select
                      id={`role-${u.id}`}
                      value={u.role}
                      disabled={busy === u.id}
                      onChange={(e) => update(u, { role: e.target.value }, `${u.email} is now ${e.target.value.toLowerCase()}.`)}
                      className="input !py-1 !text-[13px]"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <span className={`badge ${u.isActive ? "b-teal" : "b-grey"}`}>
                        {u.isActive ? "Active" : "Deactivated"}
                      </span>
                      {u.locked && (
                        <span className="badge b-red">
                          <Lock className="h-3 w-3" aria-hidden /> Locked
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden text-xs whitespace-nowrap text-ink-65 md:table-cell">
                    {u.lastLoginAt ? <LocalTime iso={u.lastLoginAt} /> : "never"}
                  </td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {u.locked && (
                        <button
                          type="button"
                          onClick={() => update(u, { unlock: true }, `${u.email} is unlocked.`)}
                          disabled={busy === u.id}
                          className="btn btn-ghost btn-sm"
                        >
                          <Unlock className="h-3.5 w-3.5" aria-hidden /> Unlock
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setResetFor(resetFor === u.id ? null : u.id);
                          setNewPassword("");
                        }}
                        disabled={busy === u.id}
                        aria-expanded={resetFor === u.id}
                        className="btn btn-ghost btn-sm"
                      >
                        New password
                      </button>
                      {u.id !== myId && (
                        <button
                          type="button"
                          onClick={() =>
                            update(
                              u,
                              { isActive: !u.isActive },
                              `${u.email} is ${u.isActive ? "deactivated" : "active again"}.`,
                            )
                          }
                          disabled={busy === u.id}
                          className={`btn btn-sm ${u.isActive ? "btn-danger" : "btn-ghost"}`}
                        >
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </div>
                    {resetFor === u.id && (
                      <form
                        className="mt-2 flex flex-wrap justify-end gap-1.5"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (await update(u, { password: newPassword }, `New password set for ${u.email}.`)) {
                            setResetFor(null);
                            setNewPassword("");
                          }
                        }}
                      >
                        <label htmlFor={`pw-${u.id}`} className="sr-only">
                          New password for {u.email}
                        </label>
                        <input
                          id={`pw-${u.id}`}
                          type="password"
                          minLength={12}
                          required
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="12+ characters"
                          className="input !w-44 !py-1 !text-[13px]"
                          autoComplete="new-password"
                        />
                        <button type="submit" disabled={busy === u.id} className="btn btn-primary btn-sm">
                          Set
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
