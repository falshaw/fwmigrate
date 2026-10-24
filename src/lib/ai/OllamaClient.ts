/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { logger } from "../logger";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:14b";

// LLM provider switch — "none" (default: no LLM), "ollama" or "claude"
// (authenticated HTTP gateway). Translation never depends on the LLM.
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "none").toLowerCase();
const LLM_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.LLM_TIMEOUT_MS || "90000", 10) || 90000,
);

export class LlmDisabledError extends Error {
  constructor() {
    super("No LLM configured (LLM_PROVIDER=none)");
    this.name = "LlmDisabledError";
  }
}

export function isLlmEnabled(): boolean {
  return LLM_PROVIDER === "ollama" || LLM_PROVIDER === "claude";
}

export function llmProvider(): string {
  return isLlmEnabled() ? LLM_PROVIDER : "none";
}

/** Model name shown next to AI output, e.g. "ollama · gemma4:31b". */
export function llmModel(): string {
  if (LLM_PROVIDER === "ollama") return OLLAMA_MODEL;
  if (LLM_PROVIDER === "claude") return (process.env.CLAUDE_MODEL || "opus").toLowerCase();
  return "";
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}
const CLAUDE_BRIDGE_URL =
  process.env.CLAUDE_BRIDGE_URL || "http://host.docker.internal:7777";
const CLAUDE_MODEL = (process.env.CLAUDE_MODEL || "opus").toLowerCase();

async function generateViaClaudeBridge(prompt: string): Promise<string> {
  const res = await fetch(`${CLAUDE_BRIDGE_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Name": "fwmigrate",
      ...(process.env.CLAUDE_BRIDGE_TOKEN
        ? { "X-Bridge-Token": process.env.CLAUDE_BRIDGE_TOKEN }
        : {}),
    },
    body: JSON.stringify({ prompt, model: CLAUDE_MODEL }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  }).catch((error: unknown) => {
    recordFailure();
    throw error;
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* keep */
    }
    recordFailure();
    throw new Error(`Claude bridge error: ${detail}`);
  }
  const data = (await res.json()) as {
    ok: boolean;
    response?: string;
    error?: string;
  };
  if (!data.ok) {
    recordFailure();
    throw new Error(`Claude bridge: ${data.error ?? "unknown error"}`);
  }
  recordSuccess();
  return data.response ?? "";
}

// Circuit breaker state (module-level, shared across all calls)
let consecutiveFailures = 0;
let circuitOpenUntil: number | null = null;
const FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;

function isCircuitOpen(): boolean {
  if (circuitOpenUntil === null) return false;
  if (Date.now() < circuitOpenUntil) return true;
  // Half-open: timeout elapsed, reset and allow retry
  circuitOpenUntil = null;
  consecutiveFailures = 0;
  return false;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    logger.warn("Ollama circuit breaker OPEN — too many failures", {
      failures: consecutiveFailures,
      reopenIn: `${CIRCUIT_OPEN_MS / 1000}s`,
    });
  }
}

/** Cleared for the process when the server says it cannot take `think`. */
let sendThinkFlag = true;

export interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
}

export async function ollamaGenerate(
  prompt: string,
  options?: { model?: string; temperature?: number; json?: boolean },
): Promise<string> {
  if (!isLlmEnabled()) throw new LlmDisabledError();
  if (isCircuitOpen()) {
    throw new Error(
      "AI service temporarily unavailable (circuit breaker open)",
    );
  }

  // Route through claude-bridge when LLM_PROVIDER=claude.
  if (LLM_PROVIDER === "claude") {
    return generateViaClaudeBridge(prompt);
  }

  const model = options?.model || OLLAMA_MODEL;
  const maxAttempts = 3;
  const backoffMs = [500, 1000];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          // Explanations need no reasoning trace. Thinking models (gemma4,
          // qwen3, ...) otherwise reason first and take several times longer.
          ...(sendThinkFlag ? { think: false } : {}),
          ...(options?.json ? { format: "json" } : {}),
          options: { temperature: options?.temperature ?? 0.3 },
        }),
        // Bounded: a slow or wedged model must never hold a request open
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });

      // Do not retry on 4xx errors (bad model name, etc.)
      if (res.status >= 400 && res.status < 500) {
        const detail = await res.text().catch(() => "");
        // Older Ollama builds or models may reject the think flag: drop it once
        if (sendThinkFlag && /think/i.test(detail)) {
          sendThinkFlag = false;
          logger.warn("Ollama rejected think=false; retrying without it", { model });
          attempt--;
          continue;
        }
        throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
      }

      if (!res.ok) {
        // 5xx — treat as transient, retry
        recordFailure();
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, backoffMs[attempt]));
          continue;
        }
        throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as OllamaResponse;
      recordSuccess();
      return data.response;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // A timeout is a failure but not worth retrying (the model is busy)
      if (isTimeout(error)) {
        recordFailure();
        throw new Error(`LLM call timed out after ${LLM_TIMEOUT_MS} ms`);
      }

      const isConnectionError =
        message.includes("ECONNREFUSED") ||
        message.includes("fetch failed") ||
        message.includes("network error");

      if (!isConnectionError) {
        throw error;
      }

      recordFailure();
      logger.error("Ollama generate failed", { error: message, attempt });
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        continue;
      }
      throw error;
    }
  }

  // Unreachable but satisfies TypeScript
  throw new Error("Ollama error: failed after retries");
}

export async function ollamaHealth(): Promise<boolean> {
  if (LLM_PROVIDER !== "ollama") return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
