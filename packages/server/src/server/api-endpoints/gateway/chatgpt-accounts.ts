// 号之间换号照 magpie（https://github.com/yetone/magpie，d5805372）：internal/gateway/codex_backend.go 的 codexAccounts、
// codexHeader、relayOnCredits 与 creditsAsked、withoutUnreadable、unreadableItem、Accept-Encoding 交给传输层；
// fallback.go 的 retryable 与 holdWriter（开口前扣住）；affinity.go 的 foreignReasoning、withoutReasoning 与默认 auto 粘性；
// internal/provider/routing.go 的被限流的排后
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import type { Request, Response } from "express";
import type pino from "pino";
import { applyEdits, modify } from "jsonc-parser";
import { isRecord, parseJson } from "../upstream-http.js";
import { conversationId, turnOf, type ConversationSticks } from "./affinity.js";
import { sendAgentError } from "./agent-errors.js";
import { chatgptTarget, relayedHeaders, type ChatGptBases } from "./chatgpt-backend.js";
import { failure, readsTooLong, retryable } from "./failure.js";
import type { LedgerAccount, LedgerCall } from "./ledger-call.js";
import { UNTIMED } from "./reply-clock.js";
import { emptyUsage } from "./translation/ir.js";
import {
  isEventStream,
  openUpstream,
  type DeliveredReply,
  type FailedAttempt,
  type OpenedUpstream,
} from "./upstream-call.js";

/*
 * Codex 第二层（ADR 0015，多号自动轮换）：ChatGPT 自带模型的对话与压缩在 Codex 的几个 ChatGPT 号之间换号。
 * 候选是请求自己登录的号（原样发）加上别的号（按用户排的顺序）；没有余量的排到最后但不去掉；
 * 粘性照 magpie 的默认 auto：同一轮留在换上的号，缓存够多、5 分钟内答过的对话跨轮也留着。
 * 发给别的号时只换 ChatGPT 登录（Authorization 与 ChatGPT-Account-Id），只属于原来那个号的头
 * （设备证明、Luna Reserve、turn-state）不带，其余照 Codex 原样。回复开口（第一段内容）之前失败、
 * 换号值得（retryable，对话太长除外）就交给下一个号；开口之后不再换。都不行时把最后一个错误原样交给 Codex。
 * 请求一律不要上游压缩：错误体要读出原文，回复按协议读出开口。
 */

/** 一个号要发请求时用的 ChatGPT 登录。 */
export interface ChatGptSignIn {
  accessToken: string;
  accountId?: string;
}

export interface ChatGptAccount {
  id: string;
  email?: string;
  // ChatGPT 账号 ID：请求头 ChatGPT-Account-Id 的值。
  identity: string;
  // 最近一次读到的额度还有余量（没读过算有）。
  hasRoom: boolean;
  // 最近一次读到的额度说这个号有 credits：用完窗口后 ChatGPT 改花 credits。
  onCredits: boolean;
  // 用它的登录（快到期先续）；拿不到（失效、已被移除、闸门关了）为 null。
  signIn(): Promise<ChatGptSignIn | null>;
}

export interface ChatGptAccounts {
  /** 这次请求能换的号；第二层没开（关着轮换、只换登录、总开关关着、号不到两个）为 null，原样转发。 */
  forRequest(): Promise<ChatGptAccount[] | null>;
}

/** 照 magpie 换号重发的路径：对话与压缩。 */
export const ACCOUNT_ROUTED_PATHS: ReadonlySet<string> = new Set([
  "/responses",
  "/responses/compact",
]);

// 只属于发请求那个号的头：发给别的号时不带（magpie codexHeader）。
const OWN_SIGN_IN_HEADERS = [
  "authorization",
  "chatgpt-account-id",
  "x-oai-attestation",
  "x-openai-codex-luna-reserve",
  "x-codex-turn-state",
];

// OpenAI 拒收别的号封存的推理（magpie foreignReasoning）与它点名的条目（unreadableItem）。
const FOREIGN_REASONING =
  /invalid_encrypted_content|encrypted[ _]content.{0,80}could not be (verified|decrypted)|could not (decrypt|verify).{0,40}encrypted[ _]content/i;
const UNREADABLE_ITEM =
  /(?:encrypted content for item|item with id) '?([A-Za-z]+_[A-Za-z0-9_-]+)'?/i;
// 同一个号为读不了的条目最多再问这么多回（magpie tries >= 3）。
const MAX_UNREADABLE_ASKS = 3;

/** 一个候选：请求自己的号（asSent，原样发），或换上去的号；endpoint 与 upstreamModel 给粘性认。 */
interface StickySeat {
  key: string;
  account: ChatGptAccount | null;
  asSent: boolean;
  hasRoom: boolean;
  onCredits: boolean;
  endpoint: { id: string };
  upstreamModel: string;
}

export interface AccountRelayInput {
  req: Request;
  res: Response;
  rest: string;
  // 要发的请求体与它的写法：Codex 原样的字节（可能压缩），或解开后改过的 JSON。
  body: Buffer;
  rewritten: boolean;
  // 解开后的请求体文字：认对话、去掉读不了的条目用。
  text: string;
  model: string;
  accounts: ChatGptAccount[];
  bases: ChatGptBases;
  sticks: ConversationSticks;
  headerTimeoutMs: number;
  logger: pino.Logger;
  // 对话（/responses）的账本；压缩不记。
  ledger: LedgerCall | null;
}

export async function relayOnAccounts(input: AccountRelayInput): Promise<void> {
  const { req, model } = input;
  const parsed = parseJson(input.text);
  const key = conversationId(req.headers, parsed);
  const seats = input.sticks.order({
    key,
    candidates: seatsFor({ headers: req.headers, accounts: input.accounts, model }),
    within: turnOf("openai", parsed).within,
    resting: (seat) => !seat.hasRoom,
  });
  const sending: Sending = {
    target: new URL(
      chatgptTarget({ url: req.url, authorization: req.headers.authorization, bases: input.bases }),
    ),
    key,
    body: input.body,
    rewritten: input.rewritten,
  };
  let last: FailedAttempt | null = null;
  for (const [index, seat] of seats.entries()) {
    const signIn = seat.asSent ? null : await seat.account?.signIn();
    if (!seat.asSent && !signIn) continue;
    const asked = await askSeat({ relay: input, sending, seat, signIn: signIn ?? null });
    if (asked === null) return;
    last = asked;
    const isLast = index === seats.length - 1;
    if (isLast || !movesOn(last)) break;
    input.logger.debug({ status: last.status }, "A ChatGPT account couldn't take the turn; next");
  }
  // 请求自己的号一定问过（它原样发，不用取登录）。
  if (last === null) throw new Error("No ChatGPT account was asked");
  sendLastFailure({ res: input.res, failed: last, ledger: input.ledger });
}

/** 这次请求发往各号时共用的：地址、对话、请求体（去掉读不了的条目后就是改过的 JSON）。 */
interface Sending {
  target: URL;
  key: string;
  body: Buffer;
  rewritten: boolean;
}

/**
 * 问一个号，直到它答了（回 null，回复已交给 Codex 或 Codex 走了）或失败（回最后一次失败）：
 * 有 credits 的号 429 时再问一次，读不了别的号封存的推理时去掉再问。
 */
async function askSeat(input: {
  relay: AccountRelayInput;
  sending: Sending;
  seat: StickySeat;
  signIn: ChatGptSignIn | null;
}): Promise<FailedAttempt | null> {
  const { relay, sending, seat, signIn } = input;
  const { res, rest } = relay;
  let creditsAsked = false;
  let unreadableAsks = 0;
  for (;;) {
    const startedAt = Date.now();
    const opening = await openUpstream({
      res,
      url: sending.target,
      headers: seatHeaders({ headers: relay.req.headers, signIn, rewritten: sending.rewritten }),
      body: sending.body,
      secrets: signIn ? [signIn.accessToken] : null,
      uncheckedHosts: [],
      headerTimeoutMs: relay.headerTimeoutMs,
      reads: rest === "/responses" ? "openai_responses" : null,
    });
    if (opening.kind === "gone") {
      relay.ledger?.cancelled();
      relay.ledger?.finish();
      return null;
    }
    if (opening.kind === "opened") {
      await answered({ relay, sending, seat, startedAt, opened: opening });
      return null;
    }
    noteFailed({ relay, seat, startedAt, failed: opening });
    const askCredits =
      !creditsAsked &&
      seat.onCredits &&
      opening.status === 429 &&
      failure(opening.status, opening.text) === "quota";
    if (askCredits) {
      // 有 credits 的号额度刚用完的那一轮可能被拒，下一轮就花 credits（magpie bf2e067e）：同一个号马上再问一次。
      creditsAsked = true;
      continue;
    }
    const readable =
      rest === "/responses" && unreadableAsks < MAX_UNREADABLE_ASKS
        ? withoutUnreadable({
            text: bodyText(sending.body, sending.rewritten, relay.text),
            failed: opening,
          })
        : null;
    if (readable === null) return opening;
    // 别的号封存的推理这个号读不了：去掉它再问同一个号（magpie withoutUnreadable）。
    unreadableAsks += 1;
    sending.body = Buffer.from(readable);
    sending.rewritten = true;
  }
}

/** 开了口：回复交给 Codex，记粘性与账本。 */
async function answered(input: {
  relay: AccountRelayInput;
  sending: Sending;
  seat: StickySeat;
  startedAt: number;
  opened: OpenedUpstream;
}): Promise<void> {
  const { relay, seat } = input;
  const { model } = relay;
  const account = ledgerAccountOf(seat);
  relay.ledger?.officialAttempt({ model, startedAt: input.startedAt, end: ANSWERED, account });
  const reply = await deliver({ res: relay.res, opened: input.opened });
  if (reply) {
    relay.sticks.answered(input.sending.key, { endpointId: seat.key, model, usage: reply.usage });
    relay.ledger?.answeredByOfficial(reply, account);
  }
  relay.ledger?.finish();
}

/** 请求自己的号排第一（原样发），其余按用户排的顺序；没有余量的排到最后（magpie 被限流的排后）。 */
function seatsFor(input: {
  headers: IncomingHttpHeaders;
  accounts: ChatGptAccount[];
  model: string;
}): StickySeat[] {
  const { model } = input;
  const own = headerValue(input.headers["chatgpt-account-id"]);
  const ownAccount = input.accounts.find((account) => account.identity === own) ?? null;
  const seats = [seatOf({ account: ownAccount, own, model })];
  for (const account of input.accounts) {
    if (account !== ownAccount) seats.push(seatOf({ account, own: null, model }));
  }
  return [...seats.filter((seat) => seat.hasRoom), ...seats.filter((seat) => !seat.hasRoom)];
}

/** 一个候选；own 不为 null 时是请求自己的号（原样发，号可能不在列表里）。粘性按 endpoint.id 认它。 */
function seatOf(input: {
  account: ChatGptAccount | null;
  own: string | null;
  model: string;
}): StickySeat {
  const { account } = input;
  const asSent = input.own !== null || account === null;
  const key = `account:${account?.id ?? input.own ?? "as-sent"}`;
  return {
    key,
    account,
    asSent,
    hasRoom: account?.hasRoom ?? true,
    onCredits: account?.onCredits ?? false,
    endpoint: { id: key },
    upstreamModel: input.model,
  };
}

/** 发给这个号的请求头：原样的号照带 Codex 的全部头；换上的号只换登录，不带只属于原来那个号的头。 */
function seatHeaders(input: {
  headers: IncomingHttpHeaders;
  signIn: ChatGptSignIn | null | undefined;
  rewritten: boolean;
}): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(relayedHeaders(input.headers))) {
    if (value !== undefined) out[name] = value;
  }
  delete out["content-length"];
  // 回复要按协议读出开口与错误原文（magpie 同样交给传输层、不要压缩）。
  delete out["accept-encoding"];
  if (input.rewritten) delete out["content-encoding"];
  const { signIn } = input;
  if (signIn) {
    for (const name of OWN_SIGN_IN_HEADERS) delete out[name];
    out.authorization = `Bearer ${signIn.accessToken}`;
    if (signIn.accountId) out["chatgpt-account-id"] = signIn.accountId;
  }
  return out;
}

/** 换下一个号值得：magpie 的 retryable，对话太长除外。 */
function movesOn(failed: FailedAttempt): boolean {
  return retryable(failed.status, failed.text) && !readsTooLong(failed.status, failed.text);
}

function noteFailed(input: {
  relay: AccountRelayInput;
  seat: StickySeat;
  startedAt: number;
  failed: FailedAttempt;
}): void {
  const { failed } = input;
  input.relay.ledger?.officialAttempt({
    model: input.relay.model,
    startedAt: input.startedAt,
    end: {
      result: "failed",
      failure: failure(failed.status, failed.text),
      reason: failed.detail,
      cooldownUntil: null,
    },
    account: ledgerAccountOf(input.seat),
  });
}

/** 账本里记的号：列表里的号；Codex 原样的登录不在列表里时不记。 */
function ledgerAccountOf(seat: StickySeat): LedgerAccount | undefined {
  const { account } = seat;
  if (!account) return undefined;
  return { id: account.id, ...(account.email ? { email: account.email } : {}) };
}

const ANSWERED = { result: "answered", failure: null, reason: null, cooldownUntil: null } as const;

/** 现在要发的请求体文字：改过的就是改过的 JSON，原样的用解开后的文字。 */
function bodyText(body: Buffer, rewritten: boolean, text: string): string {
  return rewritten ? body.toString("utf8") : text;
}

/** OpenAI 读不了的条目去掉后的请求体：它点名的那一条，或别的号封存的推理；都不是为 null。 */
function withoutUnreadable(input: { text: string; failed: FailedAttempt }): string | null {
  const { failed } = input;
  if (failed.status !== 400 && failed.status !== 404) return null;
  const foreign = FOREIGN_REASONING.test(failed.text);
  if (!foreign && !failed.text.toLowerCase().includes("not found")) return null;
  const named = UNREADABLE_ITEM.exec(failed.text)?.[1];
  const parsed = parseJson(input.text);
  const items = isRecord(parsed) && Array.isArray(parsed.input) ? parsed.input : null;
  if (items === null) return null;
  const unreadable = (item: unknown) => {
    if (!isRecord(item)) return false;
    if (named !== undefined && item.id === named) return true;
    return named === undefined && foreign && item.type === "reasoning";
  };
  let kept = items.filter((item) => !unreadable(item));
  if (kept.length === items.length && foreign) {
    kept = items.filter((item) => !(isRecord(item) && item.type === "reasoning"));
  }
  if (kept.length === items.length) return null;
  return applyEdits(input.text, modify(input.text, ["input"], kept, {}));
}

/** 开了口的回复原样交给 Codex，同时按协议读一遍（粘性与账本要用量）；回复中途断了照收到的算。 */
function deliver(input: { res: Response; opened: OpenedUpstream }): Promise<DeliveredReply | null> {
  const { res, opened } = input;
  const { response, held, tap } = opened;
  const streamed = isEventStream(response, held);
  const deliveredAt = streamed ? Date.now() : null;
  res.writeHead(opened.status, relayedHeaders(response.headers));
  res.write(held);
  const finished = (): DeliveredReply | null => {
    if (tap === null) return null;
    const reply = tap.end();
    const times = deliveredAt === null ? UNTIMED : tap.times({ notBefore: deliveredAt });
    return { id: reply.id, usage: reply.usage ?? emptyUsage(), stop: reply.stop, ...times };
  };
  if (response.readableEnded) {
    res.end();
    return Promise.resolve(finished());
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(finished());
    };
    response.on("data", (chunk: Buffer) => tap?.feed(chunk));
    response.once("end", settle);
    response.once("error", () => {
      res.destroy();
      settle();
    });
    response.once("close", () => {
      if (!response.complete) res.destroy();
      settle();
    });
    response.pipe(res);
  });
}

/**
 * 都不行：最后一个上游错误原样交给 Codex（状态码、头与错误体），Codex 照常显示「额度用完、几点恢复」。
 * 中转站自己判的失败（连不上、超时）与流里的错误没有原样的回复可交，按 OpenAI 的写法说。
 */
function sendLastFailure(input: {
  res: Response;
  failed: FailedAttempt;
  ledger: LedgerCall | null;
}): void {
  const { res, failed, ledger } = input;
  ledger?.failed(failed.detail);
  ledger?.finish();
  const contentType = String(failed.headers["content-type"] ?? "");
  const isRawReply =
    failed.cause === "error" && contentType !== "" && !contentType.includes("event-stream");
  if (!isRawReply) {
    sendAgentError({
      res,
      wire: "openai",
      error: { status: failed.status, message: failed.detail, ...failed.upstreamError },
    });
    return;
  }
  const body = Buffer.from(failed.text);
  const headers = relayedHeaders(failed.headers);
  delete headers["content-encoding"];
  headers["content-length"] = String(body.length);
  res.writeHead(failed.status, headers);
  res.end(body);
}

function headerValue(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}
