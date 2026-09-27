import { describe, it, expect } from "vitest";
import {
  isLanguageSupported,
  getSupportedExtensions,
  getParserForFile,
  getLanguageForFile,
} from "../parsers.js";

describe("isLanguageSupported", () => {
  it("returns true for supported file extensions", () => {
    expect(isLanguageSupported("test.js")).toBe(true);
    expect(isLanguageSupported("test.ts")).toBe(true);
    expect(isLanguageSupported("test.tsx")).toBe(true);
    expect(isLanguageSupported("test.py")).toBe(true);
    expect(isLanguageSupported("test.go")).toBe(true);
    expect(isLanguageSupported("test.rs")).toBe(true);
    expect(isLanguageSupported("test.json")).toBe(true);
    expect(isLanguageSupported("test.css")).toBe(true);
    expect(isLanguageSupported("test.html")).toBe(true);
    expect(isLanguageSupported("test.java")).toBe(true);
    expect(isLanguageSupported("test.swift")).toBe(true);
    expect(isLanguageSupported("test.dart")).toBe(true);
    expect(isLanguageSupported("test.cs")).toBe(true);
    expect(isLanguageSupported("test.nix")).toBe(true);
    expect(isLanguageSupported("test.ex")).toBe(true);
    expect(isLanguageSupported("Counter.svelte")).toBe(true);
    expect(isLanguageSupported("Page.astro")).toBe(true);
  });

  it("returns true for shell and config files, including Dockerfile by name", () => {
    expect(isLanguageSupported("install.sh")).toBe(true);
    expect(isLanguageSupported("Cargo.toml")).toBe(true);
    expect(isLanguageSupported("query.sql")).toBe(true);
    expect(isLanguageSupported("change.diff")).toBe(true);
    expect(isLanguageSupported("change.patch")).toBe(true);
    expect(isLanguageSupported("Dockerfile")).toBe(true);
    expect(isLanguageSupported("/repo/docker/Dockerfile")).toBe(true);
    expect(isLanguageSupported("settings.ini")).toBe(true);
    expect(isLanguageSupported("app.properties")).toBe(true);
  });

  it("returns false for unsupported file extensions", () => {
    expect(isLanguageSupported("test.xyz")).toBe(false);
    expect(isLanguageSupported("test.txt")).toBe(false);
    expect(isLanguageSupported("test.csv")).toBe(false);
  });

  it("returns false for files without extensions", () => {
    expect(isLanguageSupported("Makefile")).toBe(false);
  });

  it("handles nested paths", () => {
    expect(isLanguageSupported("src/utils/test.ts")).toBe(true);
    expect(isLanguageSupported("deep/nested/path/file.py")).toBe(true);
  });
});

describe("getSupportedExtensions", () => {
  it("returns an array of extension strings", () => {
    const extensions = getSupportedExtensions();

    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("includes common extensions", () => {
    const extensions = getSupportedExtensions();

    expect(extensions).toContain("js");
    expect(extensions).toContain("ts");
    expect(extensions).toContain("tsx");
    expect(extensions).toContain("py");
    expect(extensions).toContain("go");
    expect(extensions).toContain("rs");
    expect(extensions).toContain("swift");
    expect(extensions).toContain("dart");
    expect(extensions).toContain("cs");
    expect(extensions).toContain("nix");
    expect(extensions).toContain("json");
    expect(extensions).toContain("svelte");
    expect(extensions).toContain("astro");
  });
});

describe("fence language names", () => {
  it.each([
    ["bash", "sh"],
    ["zsh", "sh"],
    ["shell", "sh"],
    ["console", "sh"],
    ["patch", "diff"],
    ["properties", "ini"],
  ])("resolves ```%s to the same language as ```%s", (fence, canonical) => {
    const language = getLanguageForFile(`x.${fence}`);
    expect(language).not.toBeNull();
    expect(language).toBe(getLanguageForFile(`x.${canonical}`));
  });
});

describe("getParserForFile", () => {
  it("projects the parser retained by the editor language registry", () => {
    for (const extension of getSupportedExtensions()) {
      const filename = `source.${extension}`;
      expect(getParserForFile(filename)).toBe(getLanguageForFile(filename)?.parser);
    }
  });

  it("returns a parser for supported files", () => {
    expect(getParserForFile("test.js")).not.toBeNull();
    expect(getParserForFile("test.py")).not.toBeNull();
  });

  it("returns null for unsupported files", () => {
    expect(getParserForFile("test.xyz")).toBeNull();
  });

  it("returns null for files without extension", () => {
    expect(getParserForFile("noext")).toBeNull();
  });

  it("is case-insensitive for extensions", () => {
    expect(getParserForFile("test.JS")).not.toBeNull();
    expect(getParserForFile("test.Py")).not.toBeNull();
  });
});
