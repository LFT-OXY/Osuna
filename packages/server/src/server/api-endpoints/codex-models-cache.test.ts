// 用例取自 magpie（https://github.com/yetone/magpie，internal/codexcat/codexcat.go 的 WithTag、Tagged，
// internal/catalog/catalog.go 的 MagpieAdded，internal/agent/codex.go 的 codexStaleCache）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  codexCachedModels,
  codexOwnFirstModel,
  isListTagged,
  markCodexModelsCacheStale,
  staleModelsCache,
  withListTag,
} from "./codex-models-cache.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("the list tag in an ETag", () => {
  it("goes inside the quotes of the backend's ETag, or after one without them", () => {
    expect(withListTag('W/"abc"', "1a2b3c")).toBe('W/"abc+osuna-1a2b3c"');
    expect(withListTag("abc", "1a2b3c")).toBe("abc+osuna-1a2b3c");
    expect(withListTag("", "1a2b3c")).toBe("+osuna-1a2b3c");
  });

  it("is told apart from another list's tag", () => {
    expect(isListTagged('W/"abc+osuna-1a2b3c"', "1a2b3c")).toBe(true);
    expect(isListTagged('W/"abc+osuna-ffffff"', "1a2b3c")).toBe(false);
    expect(isListTagged('W/"abc"', "1a2b3c")).toBe(false);
  });
});

describe("codexCachedModels", () => {
  it("keeps ChatGPT's own models and drops the endpoint models Osuna handed Codex", () => {
    const cache = JSON.stringify({
      fetched_at: "2026-10-18T00:00:00Z",
      etag: 'W/"abc+osuna-1a2b3c"',
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5" },
        { slug: "relay-a/kimi-k2", display_name: "kimi-k2" },
        { slug: "codex-auto-review", visibility: "hide" },
      ],
    });
    expect(codexCachedModels(cache)).toEqual([
      { slug: "gpt-5.5", display_name: "GPT-5.5" },
      { slug: "codex-auto-review", visibility: "hide" },
    ]);
  });

  it("keeps a slashed slug in a list Osuna never tagged", () => {
    const cache = JSON.stringify({ etag: '"abc"', models: [{ slug: "a/b" }] });
    expect(codexCachedModels(cache)).toEqual([{ slug: "a/b" }]);
  });

  it("has nothing for a cache that is missing or unreadable", () => {
    expect(codexCachedModels(null)).toEqual([]);
    expect(codexCachedModels("not json")).toEqual([]);
    expect(codexCachedModels('{"models":"nope"}')).toEqual([]);
  });
});

describe("codexOwnFirstModel", () => {
  it("is the first of Codex's own listed models by priority", () => {
    const cache = JSON.stringify({
      etag: 'W/"abc+osuna-1a2b3c"',
      models: [
        { slug: "gpt-5.4", priority: 5 },
        { slug: "relay-a/kimi-k2", priority: 0 },
        { slug: "codex-auto-review", priority: 1, visibility: "hide" },
        { slug: "gpt-5.5", priority: 2, visibility: "list" },
      ],
    });
    expect(codexOwnFirstModel(cache)).toBe("gpt-5.5");
    expect(codexOwnFirstModel(null)).toBeNull();
  });
});

describe("staleModelsCache", () => {
  it("ages a cache of another list to 1970 and leaves the rest as Codex wrote it", () => {
    const text = `${JSON.stringify(
      {
        fetched_at: "2026-10-18T08:00:00Z",
        etag: 'W/"abc+osuna-ffffff"',
        client_version: "0.163.0",
        models: [{ slug: "gpt-5.5" }],
      },
      null,
      2,
    )}\n`;
    const aged = staleModelsCache(text, "1a2b3c");
    expect(aged).not.toBeNull();
    expect(JSON.parse(aged!)).toEqual({
      fetched_at: "1970-01-01T00:00:00Z",
      etag: 'W/"abc+osuna-ffffff"',
      client_version: "0.163.0",
      models: [{ slug: "gpt-5.5" }],
    });
  });

  it("changes only fetched_at, keeping the rest of Codex's file byte for byte", () => {
    const text =
      '{\n    "fetched_at":   "2026-10-18T08:00:00Z" ,\n    "etag": "W/\\"abc\\"",\n    "models": [ {"slug":"gpt-5.5"} ]\n}';
    expect(staleModelsCache(text, "1a2b3c")).toBe(
      '{\n    "fetched_at":   "1970-01-01T00:00:00Z" ,\n    "etag": "W/\\"abc\\"",\n    "models": [ {"slug":"gpt-5.5"} ]\n}',
    );
  });

  it("leaves a cache of the current list, an already aged one and an unreadable one alone", () => {
    const current = JSON.stringify({
      fetched_at: "2026-10-18T08:00:00Z",
      etag: '"a+osuna-1a2b3c"',
    });
    const aged = JSON.stringify({ fetched_at: "1970-01-01T00:00:00Z", etag: '"a"' });
    expect(staleModelsCache(current, "1a2b3c")).toBeNull();
    expect(staleModelsCache(aged, "1a2b3c")).toBeNull();
    expect(staleModelsCache("not json", "1a2b3c")).toBeNull();
    expect(staleModelsCache("[1]", "1a2b3c")).toBeNull();
  });
});

describe("markCodexModelsCacheStale", () => {
  function tempCodexHome(): string {
    const home = mkdtempSync(path.join(os.tmpdir(), "osuna-codex-home-"));
    homes.push(home);
    return home;
  }

  it("rewrites models_cache.json in the Codex home it is given", () => {
    const codexHome = tempCodexHome();
    const cachePath = path.join(codexHome, "models_cache.json");
    writeFileSync(cachePath, JSON.stringify({ fetched_at: "2026-10-18T08:00:00Z", etag: '"a"' }));

    expect(markCodexModelsCacheStale({ codexHome, tag: "1a2b3c" })).toEqual({
      kind: "written",
      value: null,
    });

    const written = JSON.parse(readFileSync(cachePath, "utf8")) as { fetched_at: string };
    expect(written.fetched_at).toBe("1970-01-01T00:00:00Z");
  });

  it("creates nothing when Codex has no cache yet", () => {
    const codexHome = tempCodexHome();
    markCodexModelsCacheStale({ codexHome, tag: "1a2b3c" });
    expect(() => readFileSync(path.join(codexHome, "models_cache.json"))).toThrow();
  });
});
