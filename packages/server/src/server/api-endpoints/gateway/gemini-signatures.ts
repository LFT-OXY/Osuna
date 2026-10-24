// Gemini 的思考签名移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gemini_signature.go 的 signedID、unsignedID、
// googleSignature、chatCallSignatures、sigTidy 与 signReply，gemini_sigstore.go 的 sigStore，chat.go 的 geminiCompat 与 aiStudioHost，
// codeassist.go 的 skipSignature，gemini_signature.go 的 unsignCalls）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { hostOf } from "../model-facts.js";
import { isRecord, parseJson } from "../upstream-http.js";
import type { ReplyTidy } from "./reply-tidy.js";
import { newId, type GatewayRequest, type Message } from "./translation/ir.js";

/*
 * Gemini 3 给每个思考过的步骤的第一个工具调用签名，下一个请求那个调用不带回签名就整个拒收
 * （400 "Function call is missing a thought_signature"，magpie #687）。它的 OpenAI 兼容接口把签名放在
 * tool_calls[].extra_content.google.thought_signature，Chat 客户端（Pi 的 openai-completions、AI SDK）不认、会丢掉，
 * 但都会把调用的 id 原样发回。所以签名藏进交给客户端的 id：<id>__ts<n>__<签名的 base64url>，回来时取下：
 * 发给 Gemini 的放回 extra_content，发给别家的只留调用原来的 id。n 是签名在 id 里占几个字符：客户端截短过的 id
 * 留下的半截签名不算签名（#1536）。没有签名可还的调用（别的模型做的、id 被截短的）带 Google 给没签过的历史用的值。
 * 签名能有几 KB，太长的 id 会弄坏给 id 建索引的客户端（#2411），所以签名本身存在 daemon 目录里，id 只带 16 个字符的引用：
 * <id>__tsk16__<key>；引用找不到的读作没有签名。
 */

const SIG_MARK = "__ts";
const SIG_RAW = "r";
const SIG_KEPT = "k";
const SIG_END = "__";
// Google 给没签过的历史用的值（magpie skipSignature）。
export const SKIP_SIGNATURE = "skip_thought_signature_validator";
// Google AI Studio 的 Gemini 接口。
const AI_STUDIO_HOST = "generativelanguage.googleapis.com";

const SIG_KEY_BYTES = 12;
const SIG_KEY_LENGTH = 16;
const HOUR_MS = 60 * 60 * 1000;
// 多久没读的签名删掉（magpie sigKeep）；之后那个调用按没签过的历史发给 Gemini，Gemini 收。
const SIG_KEEP_MS = 90 * 24 * HOUR_MS;
// 写入时最多这么久清理一次目录。
const SIG_PRUNE_EVERY_MS = HOUR_MS;

/** 签名按内容的摘要存成一个个文件：同一个签名不管来几次都是一个文件。存不了时 id 直接带签名本身。 */
export class GeminiSignatureStore {
  private prunedAt = 0;

  constructor(private readonly dir: string) {}

  /** 存下签名，返回 id 引用它用的 key；存不了为 ""。 */
  keep(signature: string): string {
    const key = signatureKey(signature);
    const file = path.join(this.dir, key);
    try {
      if (readFileSync(file, "utf8") === signature) {
        touch(file);
        return key;
      }
    } catch {
      // 还没存过。
    }
    const temp = path.join(this.dir, `.tmp-${newId()}`);
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const fd = openSync(temp, "w", 0o600);
      try {
        writeSync(fd, signature);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, file);
    } catch {
      removeQuietly(temp);
      return "";
    }
    this.prune();
    return key;
  }

  /** key 存着的签名；没有了、或文件内容对不上 key 为 ""。 */
  kept(key: string): string {
    if (key.length !== SIG_KEY_LENGTH || !/^[A-Za-z0-9_-]+$/.test(key)) return "";
    const file = path.join(this.dir, key);
    let signature: string;
    try {
      signature = readFileSync(file, "utf8");
    } catch {
      return "";
    }
    if (signature === "" || signatureKey(signature) !== key) return "";
    touch(file);
    return signature;
  }

  /** 最多每小时一次：删掉多久没读的签名与写入留下的临时文件。 */
  private prune(): void {
    const now = Date.now();
    if (now - this.prunedAt < SIG_PRUNE_EVERY_MS) return;
    this.prunedAt = now;
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const age = now - statSync(file).mtimeMs;
        const stale = age > SIG_KEEP_MS || (name.startsWith(".") && age > HOUR_MS);
        if (stale) rmSync(file, { force: true });
      } catch {
        // 别的进程刚删掉。
      }
    }
  }
}

function signatureKey(signature: string): string {
  const digest = createHash("sha256").update(signature).digest();
  return digest.subarray(0, SIG_KEY_BYTES).toString("base64url");
}

function removeQuietly(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // 目录本身就建不起来时临时文件也不在。
  }
}

function touch(file: string): void {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch {
    // 只影响清理的时机。
  }
}

/** 带着思考签名的调用 id。 */
export function signedId(input: {
  id: string;
  signature: string;
  store: GeminiSignatureStore;
}): string {
  const { signature } = input;
  if (signature === "") return input.id;
  const id = input.id === "" ? `call_${newId()}` : input.id;
  const key = input.store.keep(signature);
  if (key !== "") return `${id}${SIG_MARK}${SIG_KEPT}${key.length}${SIG_END}${key}`;
  const bytes = Buffer.from(signature, "base64");
  const canonical = bytes.length > 0 && bytes.toString("base64") === signature;
  const kind = canonical ? "" : SIG_RAW;
  const encoded = (canonical ? bytes : Buffer.from(signature, "utf8")).toString("base64url");
  return `${id}${SIG_MARK}${kind}${encoded.length}${SIG_END}${encoded}`;
}

/** 拆开 signedId 做的 id：调用自己的 id 与签名。别的 id、签名被截短的 id 原样，签名为 ""。 */
export function unsignedId(input: { id: string; store: GeminiSignatureStore }): {
  id: string;
  signature: string;
} {
  const { id } = input;
  const none = { id, signature: "" };
  let at = 1;
  while (at < id.length) {
    const found = id.indexOf(SIG_MARK, at);
    if (found < 0) break;
    at = found + 1;
    let rest = id.slice(found + SIG_MARK.length);
    const raw = rest.startsWith(SIG_RAW);
    if (raw) rest = rest.slice(SIG_RAW.length);
    const kept = !raw && rest.startsWith(SIG_KEPT);
    if (kept) rest = rest.slice(SIG_KEPT.length);
    const digits = /^\d*/.exec(rest)?.[0] ?? "";
    // 不是标记：调用自己的 id 里的字。
    if (!rest.slice(digits.length).startsWith(SIG_END)) continue;
    const encoded = rest.slice(digits.length + SIG_END.length);
    // 存着的签名的标记总带长度。
    if (kept && digits === "") continue;
    // 第一个标记说了算：截短过的签名不算签名。
    if (digits !== "" && digits !== String(encoded.length)) return none;
    const own = id.slice(0, found);
    if (kept) {
      const signature = input.store.kept(encoded);
      return signature === "" ? none : { id: own, signature };
    }
    const bytes = decodeBase64Url(encoded);
    if (bytes === null || bytes.length === 0) return none;
    const signature = raw ? bytes.toString("utf8") : bytes.toString("base64");
    return { id: own, signature };
  }
  return none;
}

/** 严格读 base64url（不带补齐）；读不懂为 null。 */
function decodeBase64Url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  return Buffer.from(text, "base64url");
}

/** 调用的 extra_content 里的思考签名；没有为 ""。 */
export function googleSignature(extra: unknown): string {
  if (!isRecord(extra) || !isRecord(extra.google)) return "";
  const signature = extra.google.thought_signature;
  return typeof signature === "string" ? signature : "";
}

/**
 * 这家这个模型是 Gemini 的 OpenAI 兼容接口：AI Studio 自己的；或 Gemini 模型、地址在本机或局域网（多半是挡在它前面的代理）。
 * 别处的中转不算。
 */
export function geminiCompat(input: { baseUrl: string; model: string }): boolean {
  const host = hostOf(input.baseUrl);
  if (host === AI_STUDIO_HOST) return true;
  if (!input.model.toLowerCase().includes("gemini")) return false;
  const name = host.replace(/^\[|\]$/g, "");
  if (name === "localhost" || name.endsWith(".local")) return true;
  return isLoopbackOrPrivate(name);
}

/** 回环或私有地址（Go 的 IsLoopback 与 IsPrivate）。 */
function isLoopbackOrPrivate(name: string): boolean {
  const version = isIP(name);
  if (version === 4) {
    const [a = 0, b = 0] = name.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (version === 6) {
    const lower = name.toLowerCase();
    if (lower === "::1") return true;
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00;
  }
  return false;
}

/**
 * 直转的 Chat 请求取下调用 id 里的签名：发给 Gemini 的（gemini）每个调用的签名放回 extra_content，一步里都没签名的
 * 带 skip_thought_signature_validator；发给别家的只留调用原来的 id。只改 messages。
 */
export function chatCallSignatures(input: {
  text: string;
  gemini: boolean;
  store: GeminiSignatureStore;
}): string {
  const { text, gemini, store } = input;
  const signed = text.includes(SIG_MARK);
  if (!signed && !(gemini && text.includes('"tool_calls"'))) return text;
  const body = parseJson(text);
  if (!isRecord(body) || !Array.isArray(body.messages)) return text;
  let changed = false;
  const messages: unknown[] = [];
  for (const message of body.messages) {
    const fitted = isRecord(message) ? messageSignatures({ message, gemini, store }) : null;
    if (fitted !== null) changed = true;
    messages.push(fitted ?? message);
  }
  if (!changed) return text;
  return applyEdits(text, modify(text, ["messages"], messages, {}));
}

/** 一条消息取下签名、放回 extra_content 后的样子；不用改为 null。 */
function messageSignatures(input: {
  message: Record<string, unknown>;
  gemini: boolean;
  store: GeminiSignatureStore;
}): Record<string, unknown> | null {
  const { message, store } = input;
  const out: Record<string, unknown> = Object.assign({}, message);
  let changed = false;
  if (typeof message.tool_call_id === "string") {
    const unsigned = unsignedId({ id: message.tool_call_id, store });
    if (unsigned.signature !== "") {
      out.tool_call_id = unsigned.id;
      changed = true;
    }
  }
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (calls.length === 0) return changed ? out : null;
  const signatures: string[] = [];
  const fitted = calls.map((call: unknown) => {
    if (!isRecord(call)) {
      signatures.push("");
      return call;
    }
    const copy: Record<string, unknown> = Object.assign({}, call);
    const unsigned = unsignedId({ id: typeof call.id === "string" ? call.id : "", store });
    let signature = unsigned.signature;
    if (signature !== "") {
      copy.id = unsigned.id;
      changed = true;
    }
    const given = googleSignature(call.extra_content);
    if (given !== "") signature = given;
    signatures.push(signature);
    return copy;
  });
  if (input.gemini) {
    const signedStep = signatures.some((signature) => signature !== "");
    fitted.forEach((call, index) => {
      if (!isRecord(call)) return;
      let signature = signatures[index] ?? "";
      // 签过名的一步里后面的调用：Gemini 只签第一个。
      if (signature === "" && signedStep) return;
      if (signature === "") signature = SKIP_SIGNATURE;
      if (googleSignature(call.extra_content) === signature) return;
      call.extra_content = { google: { thought_signature: signature } };
      changed = true;
    });
  }
  if (!changed) return null;
  out.tool_calls = fitted;
  return out;
}

/**
 * 直转的 Gemini Chat 回复：带思考签名来的调用改用带着签名的 id（signedId）。流按整行、整份回复攒齐在最后；
 * 没有签名的行原样。
 */
export class GeminiSignatureTidy implements ReplyTidy {
  private held = "";

  constructor(private readonly input: { stream: boolean; store: GeminiSignatureStore }) {}

  write(text: string): string {
    this.held += text;
    if (!this.input.stream) return "";
    const end = this.held.lastIndexOf("\n");
    if (end < 0) return "";
    const lines = this.held.slice(0, end + 1);
    this.held = this.held.slice(end + 1);
    return this.lines(lines);
  }

  end(): string {
    const held = this.held;
    this.held = "";
    if (!this.input.stream) return this.signed(held) ?? held;
    return this.lines(held);
  }

  private lines(text: string): string {
    if (!text.includes('"thought_signature"')) return text;
    return text
      .split(/(?<=\n)/)
      .map((line) => {
        const body = line.replace(/\r?\n$/, "");
        if (!body.startsWith("data:")) return line;
        const signed = this.signed(body.slice("data:".length).trim());
        return signed === null ? line : `data: ${signed}${line.slice(body.length)}`;
      })
      .join("");
  }

  /** 一个事件或整份回复里带签名的调用改用带签名的 id；没有要改的为 null。 */
  private signed(data: string): string | null {
    if (!data.includes('"thought_signature"')) return null;
    const reply = parseJson(data);
    if (!isRecord(reply) || !Array.isArray(reply.choices)) return null;
    let changed = false;
    for (const choice of reply.choices) {
      if (!isRecord(choice)) continue;
      for (const key of ["delta", "message"]) {
        const message = choice[key];
        if (!isRecord(message) || !Array.isArray(message.tool_calls)) continue;
        for (const call of message.tool_calls) {
          if (!isRecord(call)) continue;
          const signature = googleSignature(call.extra_content);
          if (signature === "") continue;
          const id = typeof call.id === "string" ? call.id : "";
          if (unsignedId({ id, store: this.input.store }).signature !== "") continue;
          call.id = signedId({ id, signature, store: this.input.store });
          changed = true;
        }
      }
    }
    return changed ? JSON.stringify(reply) : null;
  }
}

/**
 * 翻译读的请求取下调用 id 里的签名（magpie unsignCalls）：调用留着自己的 id，签名记在它身上（客户端在别处带回来的优先），
 * 回答它的结果改答这个 id。发给 Gemini 的带回签名，发给别家的只用调用原来的 id。不改传进来的请求。
 */
export function unsignCalls(input: {
  request: GatewayRequest;
  store: GeminiSignatureStore;
}): GatewayRequest {
  const { request, store } = input;
  let changed = false;
  const messages = request.messages.map((message): Message => {
    let touched = false;
    const parts = message.parts.map((part) => {
      if (part.kind === "tool_call") {
        const unsigned = unsignedId({ id: part.id, store });
        if (unsigned.signature === "") return part;
        touched = true;
        const signature = part.signature || unsigned.signature;
        return { ...part, id: unsigned.id, signature };
      }
      if (part.kind === "tool_result") {
        const unsigned = unsignedId({ id: part.callId, store });
        if (unsigned.signature === "") return part;
        touched = true;
        return { ...part, callId: unsigned.id };
      }
      return part;
    });
    if (!touched) return message;
    changed = true;
    return { ...message, parts };
  });
  return changed ? { ...request, messages } : request;
}
