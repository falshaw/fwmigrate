/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Reading a dropped or chosen config file in the browser.
 */

import type { FirewallVendor } from "@/lib/vendors";
import { detectVendorStrict } from "./detect-vendor";

export const CONFIG_FILE_ACCEPT = ".txt,.conf,.cfg,.xml,.json,.log,.set";
/** Same limit as the import API */
export const MAX_CONFIG_BYTES = 20 * 1024 * 1024;

export interface ConfigFile {
  name: string;
  content: string;
  /** Detected vendor, null when the format is not recognised */
  vendor: FirewallVendor | null;
}

export class ConfigFileError extends Error {}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new ConfigFileError(`${file.name} could not be read.`));
    reader.readAsText(file);
  });
}

export async function readConfigFile(file: File): Promise<ConfigFile> {
  if (file.size > MAX_CONFIG_BYTES)
    throw new ConfigFileError(
      `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB; the limit is 20 MB.`,
    );
  if (file.size === 0) throw new ConfigFileError(`${file.name} is empty.`);
  const content = await readText(file);
  // A config is text: NUL bytes mean an archive, image or other binary file
  if (content.includes("\u0000"))
    throw new ConfigFileError(`${file.name} is not a text file. Export the config as text, XML or JSON.`);
  return { name: file.name, content, vendor: detectVendorStrict(content) };
}
