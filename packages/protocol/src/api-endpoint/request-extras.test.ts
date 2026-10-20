import { describe, expect, it } from "vitest";
import {
  cleanRequestHeaders,
  extraBodyFieldName,
  extraBodyProblem,
  headerProblem,
  isThirdPartyAnthropicUrl,
  keyHeaderOf,
  takesInsecureTls,
  takesXApiKeyAlone,
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
  it("drops empty names, keeps empty values as magpie does, and keeps the later of two names differing in case", () => {
    expect(cleanRequestHeaders({ " X-Team ": " a ", "": "b", Empty: " ", "x-team": "c" })).toEqual({
      Empty: "",
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

  it("says Anthropic's own and Bedrock's addresses take x-api-key alone", () => {
    expect(takesXApiKeyAlone("https://api.anthropic.com")).toBe(true);
    expect(takesXApiKeyAlone("https://bedrock-runtime.us-east-1.amazonaws.com")).toBe(true);
    expect(takesXApiKeyAlone("https://relay.example.com")).toBe(false);
  });
});

// 照 magpie internal/gui/tests/provider-insecure-tls.test.cjs：自己加的 https 接口才有这一项。
describe("skip the certificate check", () => {
  it("is offered to an endpoint added as custom with an https address", () => {
    const urls = ["http://192.168.1.21:8000/v1", " https://192.168.1.20:8443/v1"];
    expect(takesInsecureTls({ templateId: undefined, urls })).toBe(true);
  });

  it("is not offered over plain http, nor to a template's endpoint", () => {
    expect(takesInsecureTls({ templateId: undefined, urls: ["http://192.168.1.21:8000/v1"] })).toBe(
      false,
    );
    expect(takesInsecureTls({ templateId: "openai", urls: ["https://api.openai.com/v1"] })).toBe(
      false,
    );
  });
});
