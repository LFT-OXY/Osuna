// 按 Content-Encoding 解开请求体、上限按解开后算、超限的说法移植自 magpie（https://github.com/yetone/magpie，
// internal/gateway/request_bounds.go 的 decodedBody、readBoundedRequestBody、overLimit、sizeWord，gateway.go 的 writeError 里 413 的提示）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { Readable, type Transform } from "node:stream";
import * as zlib from "node:zlib";
import type { Request } from "express";
import type pino from "pino";

/*
 * 读 Agent 发来的整个请求体：Codex 发给 OpenAI 自带服务商时用 zstd 压缩，别的客户端可能用 gzip。
 * 解开后交给中转站，之后谁也看不到压缩过的字节；直通发给上游的是解开后的请求体（不再带 Content-Encoding）。
 * 上限按解开后的大小算，边解边数，超了就停，不先把整份解出来。
 */

// @types/node 还停在 20，没有 zstd 的类型；Node 22.15 / 23.8 起 zlib 才有 createZstdDecompress。
interface ZlibWithZstd {
  createGunzip: typeof zlib.createGunzip;
  createZstdDecompress?: () => Transform;
}
const zlibWithZstd: ZlibWithZstd = zlib;

const MB = 1024 * 1024;
const READABLE_ENCODINGS = "identity, gzip or zstd";

export type AgentBody =
  | { kind: "read"; body: Buffer }
  | { kind: "tooLarge"; message: string }
  | { kind: "unreadable"; status: 400 | 415; message: string };

export async function readAgentBody(input: {
  req: Request;
  limit: number;
  logger: pino.Logger;
}): Promise<AgentBody> {
  const { req, limit } = input;
  const encoding = String(req.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  const decoder = decoderFor(encoding);
  if (decoder.kind === "unsupported") {
    req.resume();
    return { kind: "unreadable", status: 415, message: decoder.message };
  }
  const { stream } = decoder;
  const source: Readable = stream === null ? req : req.pipe(stream);
  const read = await readLimited({ source, limit });
  if (read.kind === "read") return read;
  // 不再读剩下的：解压器停下，原始请求体照收但丢掉，免得 CLI 那头卡住。
  if (stream !== null) {
    req.unpipe(stream);
    stream.destroy();
  }
  req.resume();
  if (read.kind === "tooLarge") return { kind: "tooLarge", message: overLimit(limit) };
  // 没压缩时读断了只会是 CLI 自己走了，回什么它都收不到。
  if (stream === null) {
    return { kind: "unreadable", status: 400, message: "The request body could not be read" };
  }
  input.logger.warn(
    { encoding, err: read.error },
    "API endpoint gateway could not decompress a request body",
  );
  return {
    kind: "unreadable",
    status: 400,
    message: `The request body is not valid ${encoding} data`,
  };
}

/**
 * 读出原样的请求体字节，不解压（ChatGPT 后端那组路径：ChatGPT 自带模型的请求要原样转发，
 * 先读出来才知道问的是哪个模型）。上限按原样的字节数算。
 */
export async function readRawBody(input: {
  req: Request;
  limit: number;
}): Promise<
  { kind: "read"; body: Buffer } | { kind: "tooLarge"; message: string } | { kind: "broken" }
> {
  const read = await readLimited({ source: input.req, limit: input.limit });
  if (read.kind === "read") return read;
  input.req.resume();
  if (read.kind === "tooLarge") return { kind: "tooLarge", message: overLimit(input.limit) };
  return { kind: "broken" };
}

/** 解开已经读出来的请求体（readRawBody 读的），与 readAgentBody 同样的编码、上限与说法。 */
export async function decodeAgentBody(input: {
  raw: Buffer;
  encoding: string | undefined;
  limit: number;
  logger: pino.Logger;
}): Promise<AgentBody> {
  const { raw, limit } = input;
  const encoding = (input.encoding ?? "").trim().toLowerCase();
  const decoder = decoderFor(encoding);
  if (decoder.kind === "unsupported") {
    return { kind: "unreadable", status: 415, message: decoder.message };
  }
  const { stream } = decoder;
  if (stream === null) {
    return raw.length > limit
      ? { kind: "tooLarge", message: overLimit(limit) }
      : { kind: "read", body: raw };
  }
  Readable.from([raw]).pipe(stream);
  const read = await readLimited({ source: stream, limit });
  if (read.kind === "read") return read;
  stream.destroy();
  if (read.kind === "tooLarge") return { kind: "tooLarge", message: overLimit(limit) };
  input.logger.warn(
    { encoding, err: read.error },
    "API endpoint gateway could not decompress a request body",
  );
  return {
    kind: "unreadable",
    status: 400,
    message: `The request body is not valid ${encoding} data`,
  };
}

type Decoder =
  | { kind: "decoder"; stream: Transform | null }
  | { kind: "unsupported"; message: string };

function decoderFor(encoding: string): Decoder {
  switch (encoding) {
    case "":
    case "identity":
      return { kind: "decoder", stream: null };
    case "gzip":
    case "x-gzip":
      return { kind: "decoder", stream: zlibWithZstd.createGunzip() };
    case "zstd": {
      const create = zlibWithZstd.createZstdDecompress;
      if (create) return { kind: "decoder", stream: create() };
      return {
        kind: "unsupported",
        message:
          "The Node.js running the API endpoint gateway cannot read a zstd request body; send it as identity or gzip",
      };
    }
    default:
      return {
        kind: "unsupported",
        message: `The API endpoint gateway cannot read a "${encoding}" request body; send it as ${READABLE_ENCODINGS}`,
      };
  }
}

type LimitedRead =
  | { kind: "read"; body: Buffer }
  | { kind: "tooLarge" }
  | { kind: "broken"; error: unknown };

function readLimited(input: { source: Readable; limit: number }): Promise<LimitedRead> {
  const { source, limit } = input;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const settle = (result: LimitedRead) => {
      source.off("data", onData);
      source.off("end", onEnd);
      source.off("error", onError);
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        settle({ kind: "tooLarge" });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => settle({ kind: "read", body: Buffer.concat(chunks) });
    const onError = (error: unknown) => settle({ kind: "broken", error });
    source.on("data", onData);
    source.once("end", onEnd);
    source.once("error", onError);
  });
}

/**
 * 超限的说法：说清楚是中转站的上限、不是模型的上下文，上游没被问到；CLI 原样显示这段话（magpie #1422）。
 * 要 CLI 去 /compact。
 */
function overLimit(limit: number): string {
  return (
    `The request body is over the API endpoint gateway's limit of ${limit / MB} MB (decompressed); no API endpoint was asked. ` +
    "This is the gateway's limit, not the model's context: run /compact to shorten the conversation, or start a new one."
  );
}
