// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/gemini_signature_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  GeminiSignatureStore,
  GeminiSignatureTidy,
  chatCallSignatures,
  geminiCompat,
  signedId,
  unsignedId,
} from "./gemini-signatures.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function store(): { store: GeminiSignatureStore; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "osuna-gemini-signatures-"));
  dirs.push(dir);
  return { store: new GeminiSignatureStore(path.join(dir, "signatures")), dir };
}

// 一个几 KB 的签名（Gemini 的签名是 base64）。
const SIGNATURE = Buffer.alloc(3000, 7).toString("base64");

describe("a thought signature carried in a call's id (magpie signedID, unsignedID)", () => {
  test("the id refers to the kept signature with 16 characters, and gives it back whole", () => {
    const { store: kept, dir } = store();
    const id = signedId({ id: "call_1", signature: SIGNATURE, store: kept });
    expect(id).toMatch(/^call_1__tsk16__[A-Za-z0-9_-]{16}$/);
    expect(unsignedId({ id, store: kept })).toEqual({ id: "call_1", signature: SIGNATURE });
    expect(readdirSync(path.join(dir, "signatures"))).toHaveLength(1);
  });

  test("an id a client cut short, or one referring to a signature no longer kept, has none", () => {
    const { store: kept } = store();
    const id = signedId({ id: "call_1", signature: SIGNATURE, store: kept });
    expect(unsignedId({ id: id.slice(0, -3), store: kept })).toEqual({
      id: id.slice(0, -3),
      signature: "",
    });
    const { store: empty } = store();
    expect(unsignedId({ id, store: empty })).toEqual({ id, signature: "" });
    expect(unsignedId({ id: "call__tsx", store: kept })).toEqual({
      id: "call__tsx",
      signature: "",
    });
  });

  test("where it can't be kept, the id carries the signature itself, its length said", () => {
    const { dir } = store();
    // 目录的上一级是个文件：存不进去。
    writeFileSync(path.join(dir, "file"), "x");
    const blocked = new GeminiSignatureStore(path.join(dir, "file", "below"));
    const id = signedId({ id: "call_1", signature: "c2ln", store: blocked });
    expect(id).toBe("call_1__ts4__c2ln");
    expect(unsignedId({ id, store: blocked })).toEqual({ id: "call_1", signature: "c2ln" });
    expect(unsignedId({ id: "call_1__ts4__c2l", store: blocked }).signature).toBe("");
  });
});

describe("a Chat request passed through, its calls' signatures (magpie chatCallSignatures)", () => {
  test("to Gemini: each signed call has its signature in extra_content, an unsigned step the skip value", () => {
    const { store: kept } = store();
    const signed = signedId({ id: "call_1", signature: SIGNATURE, store: kept });
    const text = JSON.stringify({
      model: "gemini-3-pro",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          tool_calls: [
            { id: signed, type: "function", function: { name: "a", arguments: "{}" } },
            { id: "call_2", type: "function", function: { name: "b", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: signed, content: "ok" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_3", type: "function", function: { name: "c", arguments: "{}" } },
          ],
        },
      ],
    });
    const sent = JSON.parse(chatCallSignatures({ text, gemini: true, store: kept }));
    expect(sent.messages[1].tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "a", arguments: "{}" },
        extra_content: { google: { thought_signature: SIGNATURE } },
      },
      { id: "call_2", type: "function", function: { name: "b", arguments: "{}" } },
    ]);
    expect(sent.messages[2].tool_call_id).toBe("call_1");
    expect(sent.messages[3].tool_calls[0].extra_content).toEqual({
      google: { thought_signature: "skip_thought_signature_validator" },
    });
  });

  test("to another upstream: the calls get their own ids back and nothing more", () => {
    const { store: kept } = store();
    const signed = signedId({ id: "call_1", signature: SIGNATURE, store: kept });
    const text = JSON.stringify({
      messages: [
        {
          role: "assistant",
          tool_calls: [{ id: signed, type: "function", function: { name: "a" } }],
        },
        { role: "tool", tool_call_id: signed, content: "ok" },
      ],
    });
    const sent = JSON.parse(chatCallSignatures({ text, gemini: false, store: kept }));
    expect(sent.messages).toEqual([
      {
        role: "assistant",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "a" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
    ]);
    const plain = '{"messages":[{"role":"user","content":"hi"}]}';
    expect(chatCallSignatures({ text: plain, gemini: false, store: kept })).toBe(plain);
  });
});

describe("a Gemini Chat reply passed through (magpie sigTidy)", () => {
  test("a call that came with a signature gets an id carrying it; other lines pass as they came", () => {
    const { store: kept } = store();
    const call = {
      index: 0,
      id: "call_1",
      type: "function",
      function: { name: "a", arguments: "{}" },
      extra_content: { google: { thought_signature: SIGNATURE } },
    };
    const text =
      'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [call] } }] })}\n\n`;
    const tidy = new GeminiSignatureTidy({ stream: true, store: kept });
    const out = tidy.write(text.slice(0, 30)) + tidy.write(text.slice(30)) + tidy.end();
    const [first, second] = out.split("\n\n");
    expect(first).toBe('data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}');
    const id = JSON.parse(second!.slice("data: ".length)).choices[0].delta.tool_calls[0].id;
    expect(unsignedId({ id, store: kept })).toEqual({ id: "call_1", signature: SIGNATURE });
  });
});

describe("which Chat upstream is Gemini's (magpie geminiCompat)", () => {
  test("AI Studio, or a Gemini model on this machine or the LAN; not a relay elsewhere", () => {
    const at = (baseUrl: string, model: string) => geminiCompat({ baseUrl, model });
    expect(at("https://generativelanguage.googleapis.com/v1beta/openai", "anything")).toBe(true);
    expect(at("http://127.0.0.1:8317/v1", "gemini-3-pro")).toBe(true);
    expect(at("http://192.168.1.5:8317/v1", "gemini-3-pro")).toBe(true);
    expect(at("http://box.local:8317/v1", "Gemini-3-Pro")).toBe(true);
    expect(at("http://127.0.0.1:8317/v1", "deepseek-v3")).toBe(false);
    expect(at("https://relay.example/v1", "gemini-3-pro")).toBe(false);
  });
});
