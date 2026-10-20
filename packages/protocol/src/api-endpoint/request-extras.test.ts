import { describe, expect, it } from "vitest";
import {
  cleanRequestHeaders,
  extraBodyFieldName,
  extraBodyProblem,
  headerProblem,
  isThirdPartyAnthropicUrl,
  keyHeaderOf,
} from "./request-extras";

// 用例照 magpie internal/provider/extrabody_test.go、authheader.go 与 app.js 的说法（7597c132）。
describe("extra body", () => {
  it("reads a forced field's name without its !", () => {
    expect(extraBodyFieldName(" !prompt_cache_key ")).toEqual({
      name: "prompt_cache_key",
      isForced: true,
    });
    expect(extraBodyFieldName("service_tier")).toEqual({ name: "service_tier", isForced: false });
  });

  it("accepts fields the request may lack, forced or not", () => {
    expect(extraBodyProblem({ prompt_cache_key: "${sessionId}", "!service_tier": "flex" })).toBe(
      null,
    );
  });

  it("refuses the reserved fields, also written with !", () => {
    expect(extraBodyProblem({ messages: [] })).toEqual({ reason: "reserved", field: "messages" });
    expect(extraBodyProblem({ "!model": "x" })).toEqual({ reason: "reserved", field: "model" });
    expect(extraBodyProblem({ system_instruction: "x" })).toEqual({
      reason: "reserved",
      field: "system_instruction",
    });
  });

  it("refuses a field without a name and one named twice", () => {
    expect(extraBodyProblem({ "!": 1 })).toEqual({ reason: "unnamed" });
    expect(extraBodyProblem({ a: 1, "!a": 2 })).toEqual({ reason: "duplicate", field: "a" });
  });
});

describe("request headers", () => {
  it("drops empty names and values and keeps the later of two names differing in case", () => {
    expect(cleanRequestHeaders({ " X-Team ": " a ", "": "b", Empty: " ", "x-team": "c" })).toEqual({
      "x-team": "c",
    });
    expect(cleanRequestHeaders({ "": "" })).toBeNull();
  });

  it("refuses a name that is no header name and a value with a line break", () => {
    expect(headerProblem({ "X Team": "a" })).toEqual({ reason: "name", name: "X Team" });
    expect(headerProblem({ "X-Team": "a\r\nInjected: 1" })).toEqual({
      reason: "value",
      name: "X-Team",
    });
    expect(headerProblem({ "anthropic-workspace-id": "wrkspc_1" })).toBeNull();
  });
});

describe("key header", () => {
  it("reads an unknown choice as both", () => {
    expect(keyHeaderOf("bearer")).toBe("bearer");
    expect(keyHeaderOf("x-api-key")).toBe("x-api-key");
    expect(keyHeaderOf("")).toBe("both");
    expect(keyHeaderOf(undefined)).toBe("both");
  });

  it("is offered for a third-party Anthropic address only", () => {
    expect(isThirdPartyAnthropicUrl("https://relay.example.com")).toBe(true);
    expect(isThirdPartyAnthropicUrl("relay.example.com/anthropic")).toBe(true);
    expect(isThirdPartyAnthropicUrl("https://api.anthropic.com")).toBe(false);
    expect(isThirdPartyAnthropicUrl("https://bedrock-runtime.us-east-1.amazonaws.com")).toBe(false);
    expect(isThirdPartyAnthropicUrl("https://res.services.ai.azure.com/anthropic")).toBe(false);
    expect(isThirdPartyAnthropicUrl("")).toBe(false);
  });
});
