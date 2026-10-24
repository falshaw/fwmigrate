/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * RFC 7807 Problem Details for HTTP APIs
 */

import { NextResponse } from "next/server";

interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export function problemResponse(problem: ProblemDetail): NextResponse {
  return NextResponse.json(problem, {
    status: problem.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export function notFound(detail?: string): NextResponse {
  return problemResponse({
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail,
  });
}

export function badRequest(detail?: string): NextResponse {
  return problemResponse({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    detail,
  });
}

export function unauthorized(detail?: string): NextResponse {
  return problemResponse({
    type: "about:blank",
    title: "Unauthorized",
    status: 401,
    detail,
  });
}

export function forbidden(detail?: string): NextResponse {
  return problemResponse({
    type: "about:blank",
    title: "Forbidden",
    status: 403,
    detail,
  });
}

export function conflict(detail?: string): NextResponse {
  return problemResponse({
    type: "about:blank",
    title: "Conflict",
    status: 409,
    detail,
  });
}

export function serverError(detail?: string): NextResponse {
  return problemResponse({
    type: "about:blank",
    title: "Internal Server Error",
    status: 500,
    detail,
  });
}
