/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * gemma4:31b with thinking on took 246 s for a two-sentence answer on a
 * laptop GPU (past the 240 s timeout); with think=false it took 59 s.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function loadClient() {
  vi.resetModules();
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_HOST = "http://ollama.test";
  process.env.OLLAMA_MODEL = "gemma4:31b";
  return import("../../src/lib/ai/OllamaClient");
}

const ok = (response: string) =>
  new Response(JSON.stringify({ model: "gemma4:31b", response, done: true }), { status: 200 });

describe("ollamaGenerate", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_PROVIDER;
  });

  it("asks the model not to think", async () => {
    const fetchMock = vi.fn(async () => ok("explained"));
    vi.stubGlobal("fetch", fetchMock);
    const { ollamaGenerate } = await loadClient();

    expect(await ollamaGenerate("explain", { json: true })).toBe("explained");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "gemma4:31b", think: false, format: "json", stream: false });
  });

  it("retries once without the flag when the server rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "\"x\" does not support thinking" }), { status: 400 }),
      )
      .mockResolvedValueOnce(ok("plain"));
    vi.stubGlobal("fetch", fetchMock);
    const { ollamaGenerate } = await loadClient();

    expect(await ollamaGenerate("explain")).toBe("plain");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(second.think).toBeUndefined();
  });

  it("still fails fast on other 4xx errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("model not found", { status: 404, statusText: "Not Found" })));
    const { ollamaGenerate } = await loadClient();
    await expect(ollamaGenerate("explain")).rejects.toThrow(/404/);
  });
});
