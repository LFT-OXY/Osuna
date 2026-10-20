import { describe, expect, test } from "vitest";
import {
  chosenKeyHeaders,
  extraBodySession,
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

describe("key header choice", () => {
  test("narrows a third-party Anthropic address only", () => {
    const relay = "https://relay.example";
    expect(
      chosenKeyHeaders({ format: "anthropic_messages", baseUrl: relay, keyHeader: "bearer" }),
    ).toBe("bearer");
    expect(
      chosenKeyHeaders({ format: "anthropic_messages", baseUrl: relay, keyHeader: "x-api-key" }),
    ).toBe("xApiKey");
    expect(
      chosenKeyHeaders({ format: "anthropic_messages", baseUrl: relay, keyHeader: "both" }),
    ).toBe(null);
    expect(
      chosenKeyHeaders({ format: "openai_chat", baseUrl: relay, keyHeader: "x-api-key" }),
    ).toBe(null);
    expect(
      chosenKeyHeaders({
        format: "anthropic_messages",
        baseUrl: "https://api.anthropic.com",
        keyHeader: "bearer",
      }),
    ).toBe(null);
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
