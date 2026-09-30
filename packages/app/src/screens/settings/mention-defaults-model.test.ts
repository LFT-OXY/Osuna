import { describe, expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import {
  applyMentionDefaultsPick,
  buildMentionDefaultsProviderModel,
} from "./mention-defaults-model";

const THINKING = [
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
];

function readyEntry(overrides: Partial<ProviderSnapshotEntry> = {}): ProviderSnapshotEntry {
  return {
    provider: "claude",
    status: "ready",
    enabled: true,
    label: "Claude",
    models: [
      {
        provider: "claude",
        id: "sonnet",
        label: "Sonnet",
        isDefault: true,
        thinkingOptions: THINKING,
        defaultThinkingOptionId: "low",
      },
      {
        provider: "claude",
        id: "opus",
        label: "Opus",
        thinkingOptions: [{ id: "max", label: "Max" }, ...THINKING],
        defaultThinkingOptionId: "high",
      },
      { provider: "claude", id: "haiku", label: "Haiku" },
      { provider: "claude", id: "hidden", label: "Hidden", isSelectable: false },
    ],
    modes: [
      { id: "default", label: "Ask" },
      { id: "plan", label: "Plan" },
    ],
    defaultModeId: "default",
    ...overrides,
  };
}

describe("buildMentionDefaultsProviderModel", () => {
  it("shows every field at its runtime default when nothing is stored", () => {
    const model = buildMentionDefaultsProviderModel(readyEntry(), undefined);

    expect(model.status).toBe("ready");
    expect(model.fields.model.view).toEqual({ kind: "default", defaultLabel: "Sonnet" });
    expect(model.fields.thinkingOptionId.view).toEqual({ kind: "default", defaultLabel: "Low" });
    expect(model.fields.modeId.view).toEqual({ kind: "default", defaultLabel: "Ask" });
    expect(model.fields.model.options.map((option) => option.id)).toEqual([
      "sonnet",
      "opus",
      "haiku",
    ]);
    expect(model.summary).toEqual({ kind: "allDefault" });
    expect(model.hasOverrides).toBe(false);
    expect(model.hasStale).toBe(false);
  });

  it("uses stored values and follows the stored model for the thinking default", () => {
    const model = buildMentionDefaultsProviderModel(readyEntry(), {
      model: "opus",
      modeId: "plan",
    });

    expect(model.fields.model.view).toEqual({ kind: "set", label: "Opus" });
    expect(model.fields.thinkingOptionId.view).toEqual({ kind: "default", defaultLabel: "High" });
    expect(model.fields.thinkingOptionId.options.map((option) => option.id)).toEqual([
      "max",
      "low",
      "high",
    ]);
    expect(model.fields.modeId.view).toEqual({ kind: "set", label: "Plan" });
    expect(model.summary).toEqual({
      kind: "values",
      parts: ["Opus", "Plan"],
      othersDefault: true,
    });
  });

  it("marks a model that left the catalog stale and falls back to the default model's level", () => {
    const model = buildMentionDefaultsProviderModel(readyEntry(), {
      model: "retired",
      thinkingOptionId: "high",
    });

    expect(model.fields.model.view).toEqual({
      kind: "stale",
      storedValue: "retired",
      fallbackLabel: "Sonnet",
    });
    // 模型失效时连同档位一起回退到默认模型的默认档位，与 daemon 一致。
    expect(model.fields.thinkingOptionId.view).toEqual({
      kind: "stale",
      storedValue: "high",
      fallbackLabel: "Low",
    });
    expect(model.hasStale).toBe(true);
    expect(model.summary).toEqual({
      kind: "values",
      parts: ["retired", "high"],
      othersDefault: true,
    });
  });

  it("marks a level the model lacks and a mode the provider lacks stale", () => {
    const model = buildMentionDefaultsProviderModel(readyEntry(), {
      model: "sonnet",
      thinkingOptionId: "max",
      modeId: "yolo",
    });

    expect(model.fields.thinkingOptionId.view).toEqual({
      kind: "stale",
      storedValue: "max",
      fallbackLabel: "Low",
    });
    expect(model.fields.modeId.view).toEqual({
      kind: "stale",
      storedValue: "yolo",
      fallbackLabel: "Ask",
    });
    expect(model.summary).toEqual({
      kind: "values",
      parts: ["Sonnet", "max", "yolo"],
      othersDefault: false,
    });
  });

  it("reports thinking and mode unsupported when the catalog has none", () => {
    const model = buildMentionDefaultsProviderModel(readyEntry({ modes: [] }), {
      model: "haiku",
    });

    expect(model.fields.thinkingOptionId.view).toEqual({ kind: "unsupported" });
    expect(model.fields.modeId.view).toEqual({ kind: "unsupported" });
  });

  it("keeps a stored level stale when the model has no levels at all", () => {
    const model = buildMentionDefaultsProviderModel(readyEntry(), {
      model: "haiku",
      thinkingOptionId: "high",
    });

    expect(model.fields.thinkingOptionId.view).toEqual({
      kind: "stale",
      storedValue: "high",
      fallbackLabel: null,
    });
  });

  it("falls back to the first mode when the default mode is not in the catalog", () => {
    const model = buildMentionDefaultsProviderModel(readyEntry({ defaultModeId: "gone" }), {});

    expect(model.fields.modeId.view).toEqual({ kind: "default", defaultLabel: "Ask" });
  });

  it("shows stored values unresolved while the catalog loads or failed", () => {
    const stored = { model: "opus", thinkingOptionId: "max" };
    const loading = buildMentionDefaultsProviderModel(
      readyEntry({ status: "loading", models: undefined }),
      stored,
    );
    const failed = buildMentionDefaultsProviderModel(
      readyEntry({ status: "error", models: undefined }),
      stored,
    );

    expect(loading.status).toBe("loading");
    expect(loading.summary).toEqual({ kind: "loading" });
    expect(loading.fields.model.view).toEqual({ kind: "unresolved", storedValue: "opus" });
    expect(failed.status).toBe("error");
    expect(failed.fields.modeId.view).toEqual({ kind: "unresolved", storedValue: null });
    expect(failed.summary).toEqual({
      kind: "values",
      parts: ["opus", "max"],
      othersDefault: true,
    });
    expect(failed.hasStale).toBe(false);
  });

  it("summarizes an unavailable provider without reading its catalog", () => {
    const model = buildMentionDefaultsProviderModel(
      readyEntry({ status: "unavailable", models: undefined }),
      {},
    );

    expect(model.summary).toEqual({ kind: "unavailable" });
    expect(model.fields.model.view).toEqual({ kind: "unresolved", storedValue: null });
  });
});

describe("applyMentionDefaultsPick", () => {
  it("sets a field and clears it again with null", () => {
    const set = applyMentionDefaultsPick({
      entry: readyEntry(),
      stored: {},
      field: "modeId",
      value: "plan",
    });
    expect(set).toEqual({ next: { modeId: "plan" }, notice: null });

    const cleared = applyMentionDefaultsPick({
      entry: readyEntry(),
      stored: { modeId: "plan" },
      field: "modeId",
      value: null,
    });
    expect(cleared).toEqual({ next: {}, notice: null });
  });

  it("keeps the level when the new model offers it", () => {
    const result = applyMentionDefaultsPick({
      entry: readyEntry(),
      stored: { model: "sonnet", thinkingOptionId: "high" },
      field: "model",
      value: "opus",
    });

    expect(result).toEqual({ next: { model: "opus", thinkingOptionId: "high" }, notice: null });
  });

  it("resets a level the new model lacks to that model's default", () => {
    const result = applyMentionDefaultsPick({
      entry: readyEntry(),
      stored: { model: "opus", thinkingOptionId: "max" },
      field: "model",
      value: "sonnet",
    });

    expect(result).toEqual({
      next: { model: "sonnet" },
      notice: { kind: "thinkingReset", defaultLabel: "Low" },
    });
  });

  it("checks the level against the default model when the model goes back to default", () => {
    const result = applyMentionDefaultsPick({
      entry: readyEntry(),
      stored: { model: "opus", thinkingOptionId: "max" },
      field: "model",
      value: null,
    });

    expect(result).toEqual({
      next: {},
      notice: { kind: "thinkingReset", defaultLabel: "Low" },
    });
  });

  it("clears the level when the new model has no levels", () => {
    const result = applyMentionDefaultsPick({
      entry: readyEntry(),
      stored: { thinkingOptionId: "high" },
      field: "model",
      value: "haiku",
    });

    expect(result).toEqual({
      next: { model: "haiku" },
      notice: { kind: "thinkingUnsupported", modelLabel: "Haiku" },
    });
  });
});
