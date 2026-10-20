import { describe, it, expect, beforeEach, vi } from "vitest";

// Valid 64-char hex key (32 bytes)
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Set env before importing
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

import {
  encrypt,
  decrypt,
  isEncrypted,
  secureCompare,
} from "../src/lib/crypto";

describe("fwmigrate crypto - encrypt", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  });

  it("should return a string starting with enc:v1: prefix", () => {
    const result = encrypt("secret firewall config");
    expect(result.startsWith("enc:v1:")).toBe(true);
  });

  it("should return empty string for empty input", () => {
    expect(encrypt("")).toBe("");
  });

  it("should produce different ciphertext for the same plaintext (random IV)", () => {
    const a = encrypt("same plaintext");
    const b = encrypt("same plaintext");
    expect(a).not.toBe(b);
  });

  it("should produce a longer string than the input (overhead from IV + auth tag)", () => {
    const input = "short";
    const result = encrypt(input);
    expect(result.length).toBeGreaterThan(input.length);
  });
});

describe("fwmigrate crypto - decrypt", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  });

  it("should roundtrip encrypt then decrypt", () => {
    const original = "security rule: allow tcp 443 from 10.0.0.0/8";
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("should return empty string for empty input", () => {
    expect(decrypt("")).toBe("");
  });

  it("should return non-encrypted string as-is (passthrough)", () => {
    const plain = "not encrypted text";
    expect(decrypt(plain)).toBe(plain);
  });

  it("should handle unicode content", () => {
    const original = "Firewall-Regel: Erlaube Zugriff von 192.168.1.0/24";
    const encrypted = encrypt(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it("should throw for tampered ciphertext", () => {
    const encrypted = encrypt("test data");
    const tampered = encrypted.slice(0, -4) + "XXXX";
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe("fwmigrate crypto - isEncrypted", () => {
  it("should return true for encrypted strings", () => {
    const encrypted = encrypt("test");
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("should return false for plain strings", () => {
    expect(isEncrypted("just plain text")).toBe(false);
  });

  it("should return false for null/undefined", () => {
    expect(isEncrypted(null as unknown as string)).toBe(false);
    expect(isEncrypted(undefined as unknown as string)).toBe(false);
  });
});

describe("fwmigrate crypto - secureCompare", () => {
  it("should return true for identical strings", () => {
    expect(secureCompare("abc123", "abc123")).toBe(true);
  });

  it("should return false for different strings", () => {
    expect(secureCompare("abc", "xyz")).toBe(false);
  });

  it("should return false for non-string inputs", () => {
    expect(secureCompare(null as unknown as string, "abc")).toBe(false);
    expect(secureCompare("abc", 123 as unknown as string)).toBe(false);
  });

  it("should return false for strings that differ only in length", () => {
    expect(secureCompare("abc", "abcd")).toBe(false);
  });
});
