// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/provider/importurl_test.go。
import { describe, expect, it } from "vitest";
import { ImportLinkRefusedError, parseImportLink } from "./import-link.js";

/* 导入链接的解析与拒收（照 magpie importurl_test.go，ADR 0013）。 */

function link(params: Record<string, string>): string {
  return `paseo://import?${new URLSearchParams(params).toString()}`;
}

function refusalOf(input: string): { reason: string; params: Record<string, string> } {
  try {
    parseImportLink(input);
  } catch (error) {
    if (error instanceof ImportLinkRefusedError) {
      return { reason: error.reason, params: error.params ?? {} };
    }
    throw error;
  }
  throw new Error(`${input} was accepted`);
}

describe("parseImportLink", () => {
  it("reads a template link with its key and models", () => {
    const parsed = parseImportLink(
      "paseo://import?preset=deepseek&key=sk-abc123&models=deepseek-v4-pro,%20deepseek-v4-flash",
    );
    expect(parsed).toMatchObject({
      identity: "deepseek",
      name: "DeepSeek",
      key: "sk-abc123",
      templateId: "deepseek",
      region: null,
      models: ["deepseek-v4-pro", "deepseek-v4-flash"],
      keysUrl: "https://platform.deepseek.com/api_keys",
    });
    expect(parsed.baseUrls).toContainEqual({
      format: "openai_chat",
      url: "https://api.deepseek.com/v1",
    });
  });

  it("takes a template's region, with that region's key page", () => {
    const parsed = parseImportLink("paseo://import?preset=siliconflow&region=intl");
    expect(parsed.region).toBe("intl");
    expect(parsed.baseUrls).toEqual([
      { format: "openai_chat", url: "https://api.siliconflow.com/v1" },
    ]);
    expect(parsed.keysUrl).toBe("https://cloud.siliconflow.com/account/ak");
    expect(refusalOf("paseo://import?preset=siliconflow&region=nowhere")).toEqual({
      reason: "unknown_region",
      params: { template: "siliconflow", region: "nowhere" },
    });
  });

  it("lets a template link carry its own name and id", () => {
    const parsed = parseImportLink("paseo://import?preset=deepseek&name=Team%20DeepSeek&id=Team");
    expect(parsed).toMatchObject({ name: "Team DeepSeek", identity: "team" });
  });

  it("reads a custom link: trims base URLs, keeps only https key pages", () => {
    const parsed = parseImportLink(
      link({
        name: "My Relay",
        chat: "https://relay.example/v1/",
        anthropic: "https://relay.example",
        key: "sk-relay",
        website: "https://relay.example",
        keys: "javascript:alert(1)",
      }),
    );
    expect(parsed).toMatchObject({
      identity: "my-relay",
      name: "My Relay",
      templateId: null,
      keysUrl: null,
      baseUrls: [
        { format: "anthropic_messages", url: "https://relay.example" },
        { format: "openai_chat", url: "https://relay.example/v1" },
      ],
    });
    expect(
      parseImportLink(
        link({ name: "R", chat: "https://r.example/v1", keys: "https://r.example/keys" }),
      ).keysUrl,
    ).toBe("https://r.example/keys");
  });

  it("allows plain http only to this machine or the local network", () => {
    for (const host of [
      "[::ffff:127.0.0.1]:8080",
      "[::ffff:10.0.0.2]",
      "localhost:11434",
      "127.0.0.1:8080",
      "192.168.1.20:8000",
      "10.0.0.2",
      "box.local",
    ]) {
      expect(
        () => parseImportLink(link({ name: "Local", chat: `http://${host}/v1` })),
        host,
      ).not.toThrow();
    }
    expect(refusalOf(link({ name: "X", chat: "http://relay.example/v1" }))).toEqual({
      reason: "needs_https",
      params: { field: "chat" },
    });
    expect(refusalOf(link({ name: "X", responses: "file:///etc/passwd" })).reason).toBe(
      "needs_https",
    );
  });

  it("refuses an address with an account, a query or a fragment", () => {
    for (const url of [
      "https://user:pw@relay.example/v1",
      "https://relay.example/v1?x=1",
      "https://relay.example/v1#top",
      "https:///v1",
    ]) {
      expect(refusalOf(link({ name: "X", anthropic: url })), url).toEqual({
        reason: "bad_url",
        params: { field: "anthropic" },
      });
    }
  });

  it("takes an empty query or fragment as Go does, and leaves it out of the base URL", () => {
    for (const url of ["https://relay.example/v1?", "https://relay.example/v1#"]) {
      expect(parseImportLink(link({ name: "X", chat: url })).baseUrls, url).toEqual([
        { format: "openai_chat", url: "https://relay.example/v1" },
      ]);
    }
  });

  it("takes the vendor icon from catalog= (magpie IconForCatalog), never a made-up one", () => {
    const base = { name: "My Relay", chat: "https://relay.example/v1" };
    expect(parseImportLink(link({ ...base, catalog: "DeepSeek" })).icon).toBe("deepseek-color");
    expect(parseImportLink(link({ ...base, catalog: "no-such-vendor" })).icon).toBeNull();
    expect(parseImportLink(link({ ...base, catalog: "../evil" })).icon).toBeNull();
  });

  it("refuses a link with no base URL, and one with only a Gemini URL", () => {
    expect(refusalOf(link({ name: "X" })).reason).toBe("no_base_url");
    expect(refusalOf("paseo://import?preset=azure").reason).toBe("no_base_url");
    expect(refusalOf(link({ name: "G", gemini: "https://relay.example/v1beta" })).reason).toBe(
      "gemini_only",
    );
  });

  it("ignores a Gemini URL beside others, but still refuses a bad one", () => {
    const parsed = parseImportLink(
      link({ name: "X", chat: "https://relay.example/v1", gemini: "https://relay.example/v1beta" }),
    );
    expect(parsed.baseUrls).toEqual([{ format: "openai_chat", url: "https://relay.example/v1" }]);
    expect(parsed.ignoredGemini).toBe(true);
    expect(
      refusalOf(link({ name: "X", chat: "https://r.example/v1", gemini: "not-a-url" })),
    ).toEqual({
      reason: "bad_url",
      params: { field: "gemini" },
    });
  });

  it("refuses an unknown template and Vertex, saying which", () => {
    expect(refusalOf("paseo://import?preset=nope")).toEqual({
      reason: "unknown_template",
      params: { template: "nope" },
    });
    for (const input of [
      "paseo://import?preset=google-vertex",
      "paseo://import?preset=Google-Vertex&key=AQ.abc&name=Vertex",
    ]) {
      expect(refusalOf(input).reason, input).toBe("vertex");
    }
  });

  it("refuses links that aren't import links or name nothing", () => {
    expect(refusalOf("https://usemagpie.ai/import?preset=deepseek").reason).toBe("not_import_link");
    expect(refusalOf("paseo://delete?id=deepseek").reason).toBe("not_import_link");
    expect(refusalOf("paseo://h/server-1/agent/agent-2").reason).toBe("not_import_link");
    expect(refusalOf("paseo://import").reason).toBe("no_name");
    expect(refusalOf(link({ name: "—", chat: "https://x.example/v1" })).reason).toBe("no_id");
  });

  it("refuses a key over 4096 bytes or with control characters", () => {
    expect(refusalOf("paseo://import?preset=deepseek&key=sk%0Aevil").reason).toBe("bad_key");
    expect(refusalOf("paseo://import?preset=deepseek&key=sk%7Fevil").reason).toBe("bad_key");
    expect(refusalOf(link({ preset: "deepseek", key: "k".repeat(4097) })).reason).toBe("bad_key");
    expect(parseImportLink(link({ preset: "deepseek", key: "k".repeat(4096) })).key).toHaveLength(
      4096,
    );
  });

  it("cuts a name to 80 bytes where a character begins", () => {
    const parsed = parseImportLink(
      link({ name: "中".repeat(40), id: "relay", chat: "https://r.example/v1" }),
    );
    expect(Buffer.byteLength(parsed.name)).toBeLessThanOrEqual(80);
    expect(parsed.name).toBe("中".repeat(26));
  });

  it("keeps at most 200 models", () => {
    const models = Array.from({ length: 250 }, (_, index) => `m-${index}`).join(",");
    expect(parseImportLink(link({ preset: "deepseek", models })).models).toHaveLength(200);
  });

  it("takes an https picture on a public host as the icon, and refuses any other", () => {
    const base = { name: "My Relay", chat: "https://relay.example/v1" };
    expect(
      parseImportLink(link({ ...base, icon: "https://relay.example/logo.svg?v=2" })).iconUrl,
    ).toBe("https://relay.example/logo.svg?v=2");
    for (const icon of [
      "http://relay.example/logo.svg",
      "file:///etc/passwd",
      "https://user:pw@relay.example/logo.svg",
      "https://relay.example/logo.svg#x",
      "https://localhost/logo.svg",
      "https://127.0.0.1/logo.svg",
      "not a url",
    ]) {
      expect(refusalOf(link({ ...base, icon })), icon).toEqual({
        reason: "bad_icon",
        params: { field: "icon" },
      });
    }
  });

  it("knows the link forms magpie takes", () => {
    for (const input of [
      "paseo:import?preset=deepseek",
      "paseo:///import?preset=deepseek",
      "PASEO://import/?preset=deepseek",
    ]) {
      expect(parseImportLink(input).templateId, input).toBe("deepseek");
    }
  });

  it("never puts the key in a refusal", () => {
    const error = (() => {
      try {
        parseImportLink("paseo://import?name=X&chat=http://relay.example/v1&key=sk-secret-123");
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(ImportLinkRefusedError);
    expect(JSON.stringify(error)).not.toContain("sk-secret-123");
    expect(String(error)).not.toContain("sk-secret-123");
  });
});
