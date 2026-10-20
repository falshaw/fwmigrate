/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import {
  advanceStatus,
  statusAfterReview,
  statusAfterTranslate,
} from "../../src/lib/projectStatus";

describe("advanceStatus (re-running analysis)", () => {
  it("moves a parsed project to Analyzed", () => {
    expect(advanceStatus("PARSED", "ANALYZED")).toBe("ANALYZED");
  });

  it("never moves a project back", () => {
    for (const s of ["TRANSLATED", "REVIEWING", "APPROVED", "EXPORTED"])
      expect(advanceStatus(s, "ANALYZED")).toBe(s);
  });

  it("recovers a project stuck in a transient state", () => {
    expect(advanceStatus("ANALYZING", "ANALYZED")).toBe("ANALYZED");
    expect(advanceStatus("TRANSLATING", "ANALYZED")).toBe("ANALYZED");
  });
});

describe("statusAfterReview", () => {
  it("is Reviewing while rules are pending and Approved when none is", () => {
    expect(statusAfterReview("TRANSLATED", 5, 10)).toBe("REVIEWING");
    expect(statusAfterReview("REVIEWING", 0, 10)).toBe("APPROVED");
  });

  it("keeps Exported", () => {
    expect(statusAfterReview("EXPORTED", 0, 10)).toBe("EXPORTED");
  });
});

describe("statusAfterTranslate (re-running translation)", () => {
  const prev = [
    { normalizedRuleId: "a", targetConfig: "set A", reviewStatus: "APPROVED" },
    { normalizedRuleId: "b", targetConfig: "set B", reviewStatus: "APPROVED" },
  ];

  it("keeps an Exported project when every rule comes out the same", () => {
    const r = statusAfterTranslate("EXPORTED", prev, [
      { normalizedRuleId: "a", targetConfig: "set A" },
      { normalizedRuleId: "b", targetConfig: "set B" },
    ]);
    expect(r).toEqual({ status: "EXPORTED", changed: 0, kept: 2 });
  });

  it("goes back to review when a rule's output changed", () => {
    const r = statusAfterTranslate("EXPORTED", prev, [
      { normalizedRuleId: "a", targetConfig: "set A" },
      { normalizedRuleId: "b", targetConfig: "set B v2" },
    ]);
    expect(r.status).toBe("REVIEWING"); // rule a keeps its approval
    expect(r.changed).toBe(1);
  });

  it("goes back to Translated when rules were re-imported", () => {
    const r = statusAfterTranslate("EXPORTED", prev, [
      { normalizedRuleId: "x", targetConfig: "set A" },
    ]);
    expect(r.status).toBe("TRANSLATED");
  });

  it("is Translated on the first run", () => {
    const r = statusAfterTranslate("ANALYZED", [], [{ normalizedRuleId: "a", targetConfig: "set A" }]);
    expect(r.status).toBe("TRANSLATED");
  });
});
