/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import { readConfigFile, ConfigFileError, MAX_CONFIG_BYTES } from "../../src/lib/ui/config-file";
import { detectVendorStrict } from "../../src/lib/ui/detect-vendor";
import { fixture } from "../generators/helpers";
import { SUPPORTED_VENDORS } from "../../src/lib/vendors";

const file = (content: string | Uint8Array, name = "config.txt") =>
  new File([content as BlobPart], name, { type: "text/plain" });

describe("readConfigFile (import page upload)", () => {
  it.each(SUPPORTED_VENDORS.map((v) => [v]))("reads a %s config and detects its vendor", async (v) => {
    const r = await readConfigFile(file(fixture(v), "fw.cfg"));
    expect(r.vendor).toBe(v);
    expect(r.content).toBe(fixture(v));
    expect(r.name).toBe("fw.cfg");
  });

  it("returns no vendor for text it does not recognise", async () => {
    expect((await readConfigFile(file("hello world"))).vendor).toBeNull();
    expect(detectVendorStrict("hello")).toBeNull();
  });

  it("rejects empty, binary and oversized files", async () => {
    await expect(readConfigFile(file(""))).rejects.toBeInstanceOf(ConfigFileError);
    await expect(readConfigFile(file(new Uint8Array([80, 75, 3, 4, 0, 0])))).rejects.toThrow(/not a text file/);
    const big = { name: "huge.txt", size: MAX_CONFIG_BYTES + 1, text: async () => "" } as unknown as File;
    await expect(readConfigFile(big)).rejects.toThrow(/limit is 20 MB/);
  });
});
