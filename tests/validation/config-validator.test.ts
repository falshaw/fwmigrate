/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * The validator must accept what the generators emit: every source fixture
 * through every target generator validates with zero errors.
 */

import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/lib/validation/ConfigValidator";
import { getParser } from "../../src/lib/parsers/ParserFactory";
import { getGenerator } from "../../src/lib/generators/GeneratorFactory";
import { SUPPORTED_VENDORS } from "../../src/lib/vendors";
import { fixture } from "../generators/helpers";

const errors = (config: string, vendor: string) =>
  validateConfig(config, vendor).issues.filter((i) => i.severity === "error");

describe("Cisco ASA access-list remarks", () => {
  it("accepts a one-word remark (was flagged as an incomplete entry)", () => {
    expect(errors("access-list inside_access_in remark Allow-DNS", "CISCO_ASA")).toEqual([]);
    expect(errors("access-list inside_access_in remark Allow DNS to resolvers", "CISCO_ASA")).toEqual([]);
  });

  it("still flags an empty remark and a short ACE", () => {
    expect(errors("access-list inside_access_in remark", "CISCO_ASA")).toHaveLength(1);
    expect(errors("access-list inside_access_in extended permit", "CISCO_ASA")).toHaveLength(1);
  });
});

describe.each(SUPPORTED_VENDORS.map((v) => [v]))("source %s", (source) => {
  it.each(SUPPORTED_VENDORS.map((v) => [v]))("-> %s output validates with no errors", async (target) => {
    const parsed = await getParser(source).parse(fixture(source));
    const out = await getGenerator(target).generate(parsed.rules, parsed.objects, []);
    expect(errors(out.config, target).map((e) => `${e.line}: ${e.message}`)).toEqual([]);
  });
});
