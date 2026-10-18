// 接口模型的压缩：问摘要、失败时以纯文字重问再本地拼、连续失败时暂停、把摘要当压缩条目交回，移植自 magpie
// （https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 codexCompact 与 compactFailure）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { Response } from "express";
import type pino from "pino";
import { isRecord, parseJson } from "../upstream-http.js";
import { sendAgentError } from "./agent-errors.js";
import {
  CompactionFailures,
  compactionKey,
  isAskedAgainAsText,
  isProtectionRefusal,
  localSummary,
  plainCompact,
} from "./codex-compaction-fallback.js";
import { compactionEvents, compactionReplyOf, type CompactionReply } from "./codex-compaction.js";

/** 摘要请求问到的回复：状态码、Content-Type、回答的那家（中转站的 answered-by 头）与整份回复。 */
export interface CompactionAnswer {
  status: number;
  contentType: string | undefined;
  answeredBy: string | undefined;
  body: Buffer;
}

/** 把一份摘要请求交给中转站按常规选路换家去问。 */
export type AskForSummary = (body: string) => Promise<CompactionAnswer>;

/** 问了一次：回复，与成功状态码时读出来的摘要（失败状态码时为 null）。 */
interface SummaryAttempt {
  answer: CompactionAnswer;
  reply: CompactionReply | null;
}

async function askForSummary(ask: AskForSummary, body: string): Promise<SummaryAttempt> {
  const answer = await ask(body);
  if (answer.status >= 400) return { answer, reply: null };
  return { answer, reply: compactionReplyOf(answer.body.toString("utf8")) };
}

/** 失败状态码时回复里说的话（OpenAI 形状的 error.message，没有就原文）。 */
function saidOf(answer: CompactionAnswer): string {
  const text = answer.body.toString("utf8");
  const parsed = parseJson(text);
  const error = isRecord(parsed) ? parsed.error : undefined;
  const message = isRecord(error) ? error.message : undefined;
  if (typeof message === "string" && message !== "") return message;
  return text.trim() || `HTTP ${answer.status}`;
}

/** 这次失败的说法：失败状态码的原话，或读不出摘要的原因。 */
function failureOf(attempt: SummaryAttempt): string {
  if (attempt.reply === null) return saidOf(attempt.answer);
  if (attempt.reply.kind === "summary") return "";
  return `broken off: ${attempt.reply.message}`;
}

/** magpie codexCompact 里以纯文字再问的那几种失败。 */
function isRetriedAsText(attempt: SummaryAttempt): boolean {
  const { answer, reply } = attempt;
  const said = answer.body.toString("utf8");
  const isRefused = answer.status >= 400 && isAskedAgainAsText({ status: answer.status, said });
  const isProtectionBreak = reply?.kind === "failed" && isProtectionRefusal(reply.message);
  return isRefused || isProtectionBreak;
}

/**
 * 压缩一段接口模型的对话（magpie codexCompact）：摘要请求交给中转站按常规选路换家问，整份读回。
 * 404、条目找不到、「Upstream request failed」、「response protection」时以纯文字的对话再问一次，再失败就本地拼摘要。
 * 其余失败照原样交给 Codex；读不出摘要、被截断、没写摘要的回 502 说明；有摘要就以压缩条目的流交回。
 * 一段对话连续失败够多时直接回 400，不再问模型（CompactionFailures）。
 */
export async function answerCodexCompaction(input: {
  res: Response;
  model: string;
  // 已经把 compaction_trigger 换成摘要提示的请求体。
  body: string;
  ask: AskForSummary;
  failures: CompactionFailures;
  logger: pino.Logger;
}): Promise<void> {
  const { res, model, body, failures, logger } = input;
  const key = compactionKey(body);
  const fail = (status: number, message: string) =>
    sendAgentError({ res, wire: "openai", error: { status, message } });
  const held = failures.held({ key, model });
  if (held !== null) {
    logger.info({ model }, held);
    fail(400, held);
    return;
  }
  const first = await askForSummary(input.ask, body);
  let attempt = first;
  let local: string | null = null;
  if (isRetriedAsText(first)) {
    const who = whoAnswered({ answer: first.answer, model });
    const said = failureOf(first);
    logger.info(
      { who, status: first.answer.status, said },
      "Compaction summary refused; asking again with the conversation as text",
    );
    attempt = await askForSummary(input.ask, plainCompact(body));
    const isFailedAgain = attempt.answer.status >= 400 || attempt.reply?.kind === "failed";
    if (isFailedAgain) {
      logger.info(
        { who, status: attempt.answer.status },
        "Compaction summary refused again; compacting locally",
      );
      local = localSummary(
        body,
        `${who} answered ${first.answer.status} to the summary request: ${said}`,
      );
    }
  }
  if (res.destroyed) return;
  const who = whoAnswered({ answer: attempt.answer, model });
  if (local === null && attempt.reply === null) {
    failures.failed({ key, status: attempt.answer.status, why: saidOf(attempt.answer) });
    if (attempt.answer.contentType !== undefined) {
      res.setHeader("content-type", attempt.answer.contentType);
    }
    res.status(attempt.answer.status).end(attempt.answer.body);
    return;
  }
  let summary: Summary = { kind: "summary", id: "", text: local ?? "", usage: null };
  if (local === null) summary = summaryOf(attempt.reply);
  if (summary.kind === "failed") {
    failures.failed({ key, status: 502, why: summary.message });
    fail(502, `compaction: ${who}: ${summary.message}, so there is no summary`);
    return;
  }
  if (summary.text.trim() === "") {
    failures.failed({ key, status: 502, why: "the model wrote no summary" });
    fail(502, "compaction: the model wrote no summary");
    return;
  }
  failures.done(key);
  let id = summary.id;
  if (id === "") id = `resp_osuna_${Date.now()}`;
  res
    .status(200)
    .set({ "content-type": "text/event-stream", "cache-control": "no-cache" })
    .end(compactionEvents({ id, summary: summary.text, usage: summary.usage }));
}

type Summary =
  | { kind: "summary"; id: string; text: string; usage: unknown }
  | { kind: "failed"; message: string };

function summaryOf(reply: CompactionReply | null): Summary {
  if (reply === null) return { kind: "failed", message: "no reply" };
  if (reply.kind === "summary") {
    return { kind: "summary", id: reply.id, text: reply.summary, usage: reply.usage };
  }
  return { kind: "failed", message: reply.message };
}

/** 回答摘要请求的是谁：那家接口的标识与模型名（magpie compactFailure 的 who）。 */
function whoAnswered(input: { answer: CompactionAnswer; model: string }): string {
  const endpoint = input.answer.answeredBy ?? input.model.split("/")[0];
  return `${endpoint} (${input.model})`;
}
