/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * src/lib/vendors.ts is the single source of truth for supported vendors.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { SUPPORTED_VENDORS } from "../src/lib/vendors";
import { getParser } from "../src/lib/parsers/ParserFactory";
import { getGenerator } from "../src/lib/generators/GeneratorFactory";
import { createProjectSchema } from "../src/lib/validators/project";
import { FIXTURES } from "./generators/helpers";

describe("supported vendors", () => {
  it("matches the Prisma FirewallVendor enum exactly", () => {
    const schema = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf-8");
    const body = schema.match(/enum FirewallVendor \{([^}]+)\}/)![1];
    const values = body
      .split("\n")
      .map((l) => l.replace(/\/\/.*/, "").trim())
      .filter(Boolean);
    expect(values).toEqual([...SUPPORTED_VENDORS]);
  });

  it.each(SUPPORTED_VENDORS.map((v) => [v]))(
    "%s has a parser, a generator and a test fixture",
    (v) => {
      expect(getParser(v).vendor).toBe(v);
      expect(getGenerator(v).vendor).toBe(v);
      expect(existsSync(join(__dirname, "fixtures", FIXTURES[v]))).toBe(true);
    },
  );

  it("the API accepts every supported vendor and rejects anything else", () => {
    for (const v of SUPPORTED_VENDORS)
      expect(
        createProjectSchema.safeParse({ name: "x", sourceVendor: v, targetVendor: v }).success,
      ).toBe(true);
    for (const v of ["SOPHOS", "CISCO_FTD", "MIKROTIK"])
      expect(
        createProjectSchema.safeParse({ name: "x", sourceVendor: v, targetVendor: "FORTINET" })
          .success,
      ).toBe(false);
  });

  it("the README vendor table lists exactly the supported vendors", () => {
    const readme = readFileSync(join(__dirname, "../README.md"), "utf-8");
    const section = readme.split("## Supported vendors")[1].split("\n## ")[0];
    const rows = section
      .split("\n")
      .filter((l) => /^\| [^-|]/.test(l) && !l.startsWith("| Vendor"));
    expect(rows).toHaveLength(SUPPORTED_VENDORS.length);
  });
});
