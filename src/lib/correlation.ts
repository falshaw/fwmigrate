/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Correlation ID management for request tracing
 */

const isServer = typeof window === "undefined";

let AsyncLocalStorage: typeof import("async_hooks").AsyncLocalStorage | null =
  null;
let randomUUID: typeof import("crypto").randomUUID | null = null;

if (isServer) {
  // Server-only modules, loaded lazily so this file stays importable client-side
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AsyncLocalStorage = require("async_hooks").AsyncLocalStorage;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID = require("crypto").randomUUID;
}

export interface RequestContext {
  correlationId: string;
  startTime: number;
  userId?: string;
  path?: string;
  method?: string;
}

type AsyncLocalStorageType =
  import("async_hooks").AsyncLocalStorage<RequestContext>;
let asyncLocalStorage: AsyncLocalStorageType | null = null;

if (isServer && AsyncLocalStorage) {
  asyncLocalStorage = new AsyncLocalStorage<RequestContext>();
}

export function getRequestContext(): RequestContext | undefined {
  if (!asyncLocalStorage) return undefined;
  return asyncLocalStorage.getStore();
}

export function getCorrelationId(): string {
  if (!asyncLocalStorage) return "no-context";
  return asyncLocalStorage.getStore()?.correlationId || "no-context";
}

export function getContextUserId(): string | undefined {
  if (!asyncLocalStorage) return undefined;
  return asyncLocalStorage.getStore()?.userId;
}

export function generateCorrelationId(): string {
  if (randomUUID) {
    return `cid-${randomUUID().slice(0, 8)}`;
  }
  return `cid-${Math.random().toString(36).slice(2, 10)}`;
}

export function runWithContext<T>(
  context: Partial<RequestContext>,
  fn: () => T,
): T {
  const fullContext: RequestContext = {
    correlationId: context.correlationId || generateCorrelationId(),
    startTime: context.startTime || Date.now(),
    ...context,
  };
  if (!asyncLocalStorage) return fn();
  return asyncLocalStorage.run(fullContext, fn);
}

export const CORRELATION_ID_HEADER = "x-correlation-id";
