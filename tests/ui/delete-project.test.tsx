/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DeleteProjectButton } from "../../src/components/DeleteProjectButton";

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project = { id: "p1", name: "Edge PAN-OS to FortiGate", ruleCount: 18 };

describe("DeleteProjectButton", () => {
  it("asks first, then deletes and reports back", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onDeleted = vi.fn();
    render(<DeleteProjectButton project={project} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/projects/p1", { method: "DELETE" });
  });

  it("cancel deletes nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<DeleteProjectButton project={project} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows why a delete was refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const onDeleted = vi.fn();
    render(<DeleteProjectButton project={project} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Only administrators/);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("names the project on the icon variant", () => {
    render(<DeleteProjectButton project={project} variant="icon" onDeleted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete project Edge PAN-OS to FortiGate" })).toBeTruthy();
  });
});

describe("deleting a project removes all its rows", () => {
  it("every relation to MigrationProject cascades on delete", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
    const relations = [...schema.matchAll(/^\s+\w+\s+MigrationProject\s+@relation\(([^)]*)\)/gm)].map(
      (m) => m[1],
    );
    // SourceConfig, rules, objects, NAT, analysis, translations, zones, plan, validations, versions
    expect(relations.length).toBeGreaterThanOrEqual(10);
    for (const r of relations) expect(r).toContain("onDelete: Cascade");
  });
});
