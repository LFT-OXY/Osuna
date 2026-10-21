// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/provider/account_test.go、extrabody_test.go。
import { describe, expect, test } from "vitest";
import {
  extraBodySession,
  keyHeadersAt,
  secretsOf,
  unsendableHeader,
  ownsKeyHeader,
  testSession,
  withExtraBody,
  withUserHeaders,
  type RequestExtras,
} from "./request-extras.js";

function extrasOf(input: Partial<RequestExtras>): RequestExtras {
  return { headers: {}, extraBody: {}, keyHeader: "both", ...input };
}

// 用例照 magpie internal/provider/account_test.go、extrabody_test.go 的说法（7597c132）。
describe("user headers", () => {
  test("replace Osuna's header of the same name in any case, under the name the user wrote", () => {
    const sent = withUserHeaders(
      { authorization: "Bearer sk-own", "user-agent": "claude-cli/2", accept: "*/*" },
      extrasOf({ headers: { Authorization: "Token mine", "User-Agent": "relay-app/1" } }),
    );
    expect(sent).toEqual({
      accept: "*/*",
      Authorization: "Token mine",
      "User-Agent": "relay-app/1",
    });
  });

  test("add the user's betas after the CLI's, each once", () => {
    const sent = withUserHeaders(
      { "anthropic-beta": "context-1m-2025-08-07, interleaved-thinking" },
      extrasOf({ headers: { "Anthropic-Beta": "interleaved-thinking,relay-beta" } }),
    );
    expect(sent).toEqual({
      "Anthropic-Beta": "context-1m-2025-08-07,interleaved-thinking,relay-beta",
    });
  });

  test("count a user's Authorization or x-api-key as owning the key header", () => {
    expect(ownsKeyHeader(extrasOf({ headers: { "X-Api-Key": "k" } }))).toBe(true);
    expect(ownsKeyHeader(extrasOf({ headers: { "anthropic-workspace-id": "w" } }))).toBe(false);
  });
});

describe("which header the key goes in (magpie AuthHeaders)", () => {
  function keysAt(input: {
    format?: "anthropic_messages" | "openai_chat";
    baseUrl: string;
    keyHeader?: "both" | "x-api-key" | "bearer";
    templateId?: string;
  }) {
    return keyHeadersAt({
      format: input.format ?? "anthropic_messages",
      templateId: input.templateId,
      baseUrl: input.baseUrl,
      keyHeader: input.keyHeader ?? "both",
      anthropicDefault: "both",
    });
  }

  test("a third-party Anthropic address takes both, or the one the user picked", () => {
    const relay = "https://relay.example";
    expect(keysAt({ baseUrl: relay })).toBe("both");
    expect(keysAt({ baseUrl: relay, keyHeader: "x-api-key" })).toBe("xApiKey");
    expect(keysAt({ baseUrl: relay, keyHeader: "bearer" })).toBe("bearer");
    expect(keysAt({ format: "openai_chat", baseUrl: relay, keyHeader: "x-api-key" })).toBe(
      "bearer",
    );
  });

  test("Anthropic's own and Bedrock's addresses take x-api-key alone, whatever was picked", () => {
    expect(keysAt({ baseUrl: "https://api.anthropic.com", keyHeader: "bearer" })).toBe("xApiKey");
    expect(keysAt({ baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com" })).toBe("xApiKey");
    expect(
      keysAt({ format: "openai_chat", baseUrl: "https://x.example", templateId: "azure" }),
    ).toBe("apiKey");
  });
});

describe("what is redacted from errors", () => {
  test("the key and every user header value, a scheme's credential on its own too; short values stay", () => {
    const extras = extrasOf({
      headers: { Authorization: "Bearer sk-user-own", "X-Team": "t1", "X-Org": "org-secret" },
    });
    expect(secretsOf({ apiKey: "sk-key", extras })).toEqual([
      "sk-key",
      "Bearer sk-user-own",
      "sk-user-own",
      "org-secret",
    ]);
  });

  test("a header that can't be sent is found before sending", () => {
    expect(unsendableHeader(extrasOf({ headers: { "X Team": "a" } }))).toEqual({
      reason: "name",
      name: "X Team",
    });
    expect(unsendableHeader(extrasOf({ headers: { "X-Team": "" } }))).toBeNull();
  });
});

describe("extra body", () => {
  const extraBody = {
    prompt_cache_key: "${sessionId}",
    "!service_tier": "flex",
    metadata: { user_id: "u-${sessionId}", tags: ["${sessionId}"] },
    model: "never",
    "!stream": false,
  };

  test("fills in what the body lacks, forces a ! field, leaves reserved ones and puts in the session", () => {
    const body = { model: "glm-5", stream: true, service_tier: "auto", metadata: { a: 1 } };
    expect(withExtraBody({ body, extraBody, session: "s-1" })).toEqual({
      model: "glm-5",
      stream: true,
      service_tier: "flex",
      metadata: { a: 1 },
      prompt_cache_key: "s-1",
    });
    const bare = { model: "glm-5" };
    expect(withExtraBody({ body: bare, extraBody, session: "s-2" })).toEqual({
      model: "glm-5",
      prompt_cache_key: "s-2",
      service_tier: "flex",
      metadata: { user_id: "u-s-2", tags: ["s-2"] },
    });
    // 存的附加请求体不被改。
    expect(extraBody.metadata.user_id).toBe("u-${sessionId}");
  });

  test("hands back the same body when nothing changes", () => {
    const body = { model: "glm-5", prompt_cache_key: "mine" };
    const cacheKey = { prompt_cache_key: "${sessionId}" };
    expect(withExtraBody({ body, extraBody: cacheKey, session: "s" })).toBe(body);
  });
});

describe("conversation id for ${sessionId}", () => {
  test("is the agent's session header, else the same for every turn of a conversation", () => {
    expect(extraBodySession({ "x-claude-code-session-id": " cc-1 " }, {})).toBe("cc-1");
    expect(extraBodySession({ session_id: "codex-thread" }, {})).toBe("codex-thread");
    const first = { messages: [{ role: "user", content: "fix the bug" }] };
    const later = {
      messages: [
        { role: "user", content: "fix the bug" },
        { role: "assistant", content: "done" },
        { role: "user", content: "thanks" },
      ],
    };
    const id = extraBodySession({}, first);
    expect(id).toMatch(/^osuna-[0-9a-f]{24}$/);
    expect(extraBodySession({}, later)).toBe(id);
    const other = { messages: [{ role: "user", content: "write docs" }] };
    expect(extraBodySession({}, other)).not.toBe(id);
  });

  test("a test asks on a session of its own", () => {
    expect(testSession()).toMatch(/^osuna-test-[0-9a-f]{12}$/);
  });
});
