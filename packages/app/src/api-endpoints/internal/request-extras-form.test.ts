import { describe, expect, it } from "vitest";
import {
  extraBodyOf,
  extraBodyTextOf,
  headerHintsLeft,
  headerRowsOf,
  headerRowsProblem,
  headersToSave,
  isBrokenJson,
  minifiedJson,
  prettyJson,
} from "./request-extras-form";

// 用例照 magpie internal/gui/assets/app.js 的 headersOf、extraBodyOf（7597c132）。
describe("request headers in the form", () => {
  it("saves named rows with a value, the later of two names in any case, JSON on one line", () => {
    const rows = [
      { id: 0, name: " X-Team ", value: " a ", isJson: false },
      { id: 1, name: "", value: "orphan", isJson: false },
      { id: 2, name: "Empty", value: " ", isJson: false },
      { id: 3, name: "x-team", value: "b", isJson: false },
      { id: 4, name: "X-Meta", value: '{\n  "a": 1\n}', isJson: true },
      { id: 5, name: "X-Version", value: "2.0", isJson: false },
    ];
    expect(headersToSave(rows)).toEqual({ "x-team": "b", "X-Meta": '{"a":1}', "X-Version": "2.0" });
  });

  it("says when a name is no header name", () => {
    expect(headerRowsProblem([{ id: 0, name: "X Team", value: "a", isJson: false }])).toEqual({
      reason: "name",
      name: "X Team",
    });
    expect(headerRowsProblem(headerRowsOf({ "anthropic-workspace-id": "w" }))).toBeNull();
  });

  it("offers the template's headers the form has not got yet", () => {
    const rows = headerRowsOf({ "Anthropic-Workspace-Id": "w" });
    expect(headerHintsLeft(["anthropic-workspace-id", "HTTP-Referer"], rows)).toEqual([
      "HTTP-Referer",
    ]);
  });

  it("lays JSON out and back, leaving other text alone", () => {
    expect(prettyJson('{"a":[1]}')).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(minifiedJson('{\n "a": 1 }')).toBe('{"a":1}');
    expect(prettyJson("{ not json")).toBe("{ not json");
    expect(isBrokenJson("{ not json")).toBe(true);
    expect(isBrokenJson("plain")).toBe(false);
  });
});

describe("extra body in the form", () => {
  it("reads an object, an empty box as none, and shows a stored one laid out", () => {
    expect(extraBodyOf("")).toEqual({ kind: "ok", value: {} });
    expect(extraBodyOf('{"prompt_cache_key": "${sessionId}"}')).toEqual({
      kind: "ok",
      value: { prompt_cache_key: "${sessionId}" },
    });
    expect(extraBodyTextOf({ "!service_tier": "flex" })).toBe('{\n  "!service_tier": "flex"\n}');
    expect(extraBodyTextOf(undefined)).toBe("");
  });

  it("says what is wrong: not JSON, not an object, a reserved field", () => {
    expect(extraBodyOf("{")).toEqual({ kind: "invalid", problem: { reason: "notJson" } });
    expect(extraBodyOf("[1]")).toEqual({ kind: "invalid", problem: { reason: "notObject" } });
    expect(extraBodyOf('{"!messages": []}')).toEqual({
      kind: "invalid",
      problem: { reason: "reserved", field: "messages" },
    });
  });
});
