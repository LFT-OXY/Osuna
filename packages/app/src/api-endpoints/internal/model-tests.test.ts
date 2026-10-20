import { describe, expect, it } from "vitest";
import type { ApiEndpointModelTestResult } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  afterProgress,
  afterResponse,
  contextTag,
  splitAroundId,
  filterModelIds,
  isNamedFree,
  offeredCliTests,
  offersFreeOnly,
  startTests,
  testSummary,
  testTook,
  wasAsked,
  type ModelTests,
} from "./model-tests";

function result(modelId: string, ok: boolean): ApiEndpointModelTestResult {
  return {
    modelId,
    ok,
    format: "openai_chat",
    status: ok ? 200 : 404,
    durationMs: 120,
    error: ok ? null : { code: "upstream_error", message: "no such model" },
  };
}

describe("isNamedFree", () => {
  it("takes free as its own word of the id or the display name, not inside another word", () => {
    expect(isNamedFree(["openrouter/qwen3-coder:free"])).toBe(true);
    expect(isNamedFree(["glm-4.5-air", "GLM 4.5 Air (Free)"])).toBe(true);
    expect(isNamedFree(["free-model"])).toBe(true);
    expect(isNamedFree(["freedom-7b"])).toBe(false);
    expect(isNamedFree(["carefree-1"])).toBe(false);
    expect(isNamedFree(["gpt-5", undefined])).toBe(false);
  });
});

describe("contextTag", () => {
  it("tags a window of a million tokens or more, unless the name already says it", () => {
    expect(contextTag({ context: 1_000_000, name: undefined })).toBe("1M");
    expect(contextTag({ context: 1_048_576, name: "Gemini 3 Pro" })).toBe("1M");
    expect(contextTag({ context: 2_000_000, name: undefined })).toBe("2M");
    expect(contextTag({ context: 1_500_000, name: undefined })).toBe("1.5M");
    expect(contextTag({ context: 400_000, name: undefined })).toBeNull();
    expect(contextTag({ context: undefined, name: undefined })).toBeNull();
    expect(contextTag({ context: 1_000_000, name: "Sonnet 4.5 1M" })).toBeNull();
  });
});

describe("testTook", () => {
  it("says milliseconds under a second, then seconds with one decimal under ten", () => {
    expect(testTook(412)).toEqual({ unit: "ms", value: "412" });
    expect(testTook(1_234)).toEqual({ unit: "s", value: "1.2" });
    expect(testTook(12_400)).toEqual({ unit: "s", value: "12" });
  });
});

describe("page-memory test results", () => {
  it("marks the models being tested, fills them in as they finish, and drops what never came back", () => {
    let tests: ModelTests = { kept: { status: "done", result: result("kept", true) } };
    tests = startTests(tests, ["a", "b", "c"]);
    expect(tests.a).toEqual({ status: "testing" });
    expect(tests.kept?.status).toBe("done");

    tests = afterProgress(tests, result("b", false));
    expect(tests.b).toEqual({ status: "done", result: result("b", false) });

    // 取消后只回来 b：a、c 回到没测过。
    tests = afterResponse(tests, [result("b", false)]);
    expect(tests.a).toBeUndefined();
    expect(tests.c).toBeUndefined();
    expect(tests.b?.status).toBe("done");
    expect(tests.kept?.status).toBe("done");
  });

  it("sums up the last run's failures", () => {
    expect(testSummary([result("a", true), result("b", false), result("c", false)])).toEqual({
      failed: 2,
      total: 3,
    });
  });
});

describe("filterModelIds", () => {
  const ids = ["gpt-5", "qwen3:free", "glm-4.5", "kimi-k2"];
  const nameOf = (id: string) => (id === "glm-4.5" ? "GLM 4.5 (free)" : undefined);
  const tests: ModelTests = {
    "gpt-5": { status: "done", result: result("gpt-5", false) },
    "qwen3:free": { status: "done", result: result("qwen3:free", true) },
    "kimi-k2": { status: "testing" },
  };

  it("keeps everything with no filter on", () => {
    expect(filterModelIds({ ids, nameOf, tests, isFreeOnly: false, isWorkingOnly: false })).toEqual(
      ids,
    );
  });

  it("Working only drops the last failures and keeps the untested and the ones still testing", () => {
    expect(filterModelIds({ ids, nameOf, tests, isFreeOnly: false, isWorkingOnly: true })).toEqual([
      "qwen3:free",
      "glm-4.5",
      "kimi-k2",
    ]);
  });

  it("Free only keeps models named free by id or display name, and the two combine", () => {
    expect(filterModelIds({ ids, nameOf, tests, isFreeOnly: true, isWorkingOnly: false })).toEqual([
      "qwen3:free",
      "glm-4.5",
    ]);
    expect(
      filterModelIds({
        ids,
        nameOf,
        tests: { ...tests, "glm-4.5": { status: "done", result: result("glm-4.5", false) } },
        isFreeOnly: true,
        isWorkingOnly: true,
      }),
    ).toEqual(["qwen3:free"]);
  });

  it("offers Free only only when the list has both free and paid models", () => {
    expect(offersFreeOnly({ ids, nameOf })).toBe(true);
    expect(offersFreeOnly({ ids: ["gpt-5"], nameOf })).toBe(false);
    expect(offersFreeOnly({ ids: ["qwen3:free"], nameOf })).toBe(false);
  });
});

describe("splitAroundId", () => {
  it("cuts the text around the model id and keeps every character as sent", () => {
    const text = "The model bad-model does not exist";
    const pieces = splitAroundId({ text, id: "bad-model" });
    expect(pieces).toEqual([
      { text: "The model ", isId: false, offset: 0 },
      { text: "bad-model", isId: true, offset: 10 },
      { text: " does not exist", isId: false, offset: 19 },
    ]);
    expect(pieces.map((piece) => piece.text).join("")).toBe(text);
    expect(splitAroundId({ text: "rate limited", id: "gpt-5" })).toEqual([
      { text: "rate limited", isId: false, offset: 0 },
    ]);
  });
});

describe("wasAsked", () => {
  it("is true only for a result that sent a request", () => {
    expect(wasAsked(result("a", true))).toBe(true);
    expect(wasAsked(result("b", false))).toBe(true);
    for (const code of ["model_disabled", "no_format", "batch_timeout"]) {
      const unsent = {
        modelId: "c",
        ok: false,
        format: null,
        status: null,
        durationMs: 0,
        error: { code, message: "" },
      };
      expect(wasAsked(unsent)).toBe(false);
    }
  });
});

describe("offeredCliTests", () => {
  it("keeps the CLI test methods the app knows and drops a newer host's others", () => {
    const missing = { code: "cli_sample_missing", message: "No sample" };
    expect(
      offeredCliTests([
        { method: "codex", unavailable: null },
        { method: "claude_code", unavailable: missing },
        { method: "a_future_cli", unavailable: null },
      ]),
    ).toEqual([
      { method: "codex", unavailable: null },
      { method: "claude_code", unavailable: missing },
    ]);
    expect(offeredCliTests(undefined)).toEqual([]);
  });
});
