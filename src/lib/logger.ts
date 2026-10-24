/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import {
  getCorrelationId,
  getContextUserId,
  getRequestContext,
} from "./correlation";

const isServer = typeof window === "undefined";
const isDev = process.env.NODE_ENV === "development";

type LogLevel = "error" | "warn" | "info" | "debug";
type LogMeta = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  userId?: string;
  durationMs?: number;
  meta?: LogMeta;
  service: string;
}

function formatLog(level: LogLevel, message: string, meta?: LogMeta): LogEntry {
  const correlationId = isServer ? getCorrelationId() : undefined;
  const userId = isServer ? getContextUserId() : undefined;
  const ctx = isServer ? getRequestContext() : undefined;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: "fwmigrate",
  };

  if (correlationId && correlationId !== "no-context")
    entry.correlationId = correlationId;
  if (userId) entry.userId = userId;
  if (ctx?.startTime) entry.durationMs = Date.now() - ctx.startTime;
  if (meta && Object.keys(meta).length > 0) entry.meta = meta;

  return entry;
}

function output(level: LogLevel, entry: LogEntry): void {
  if (isServer) {
    const logFn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    logFn(JSON.stringify(entry));
  } else {
    if (isDev) {
      const logFn =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : level === "debug"
              ? console.debug
              : console.info;
      logFn(`[${level.toUpperCase()}] ${entry.message}`, entry.meta || "");
    } else if (level === "error" || level === "warn") {
      console[level](entry.message, entry.meta);
    }
  }
}

export const logger = {
  error: (message: string, meta?: LogMeta) =>
    output("error", formatLog("error", message, meta)),
  warn: (message: string, meta?: LogMeta) =>
    output("warn", formatLog("warn", message, meta)),
  info: (message: string, meta?: LogMeta) =>
    output("info", formatLog("info", message, meta)),
  debug: (message: string, meta?: LogMeta) => {
    if (isDev) output("debug", formatLog("debug", message, meta));
  },

  api: {
    request: (method: string, path: string, meta?: LogMeta) =>
      logger.info(`API ${method} ${path}`, { type: "api_request", ...meta }),
    error: (method: string, path: string, error: unknown, meta?: LogMeta) =>
      logger.error(`API ${method} ${path} failed`, {
        type: "api_error",
        error: error instanceof Error ? error.message : String(error),
        ...meta,
      }),
  },

  parser: {
    run: (
      vendor: string,
      status: "start" | "success" | "error",
      meta?: LogMeta,
    ) => {
      const level = status === "error" ? "error" : "info";
      logger[level](`Parser ${vendor} ${status}`, {
        type: "parser",
        vendor,
        ...meta,
      });
    },
  },

  translation: {
    run: (status: "start" | "success" | "error", meta?: LogMeta) => {
      const level = status === "error" ? "error" : "info";
      logger[level](`Translation ${status}`, { type: "translation", ...meta });
    },
  },
};

export default logger;
