// 粘贴的 curl 命令的读法照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 curlOf 与
// respellURL，7597c132）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/** 从服务商文档里整段粘贴的 curl 命令读出的、添加窗口用得上的东西。 */
export interface CurlCommand {
  url: string;
  // URL 结尾认出的格式；认不出为 null，这时 baseUrl 也为 null。
  format: ApiEndpointRequestFormat | null;
  // 按这种格式的写法得出的地址（respellURL）。
  baseUrl: string | null;
  // 地址里还没替换的占位符，如 `{WorkspaceId}`。
  urlPlaceholder: string | null;
  apiKey: string | null;
  // key 只是占位符（`$OPENAI_API_KEY`、`%KEY%`、`<token>`、`YOUR_API_KEY`）时的原文；这时 apiKey 为 null。
  keyPlaceholder: string | null;
  // JSON 正文里的 model。
  model: string | null;
}

const ENDPOINT_FORMATS: Record<string, ApiEndpointRequestFormat> = {
  "/chat/completions": "openai_chat",
  "/messages": "anthropic_messages",
  "/responses": "openai_responses",
};

// curl 会在其后读一个值的选项；其余选项单独成词。
const VALUED_OPTION =
  /^(-[HdXuoAeFbcmT]|--(header|data|data-raw|data-binary|data-ascii|data-urlencode|json|request|url|user|output|user-agent|referer|form|cookie|max-time|connect-timeout|proxy|upload-file|retry|cert|key|cacert))$/;

const KEY_PLACEHOLDER =
  /^\$|^%\w+%$|^<.*>$|^\{\{.*\}\}$|^\[.*\]$|your[_-]?|api[_-]?key|x{6,}|\.\.\.|…/i;

/**
 * 把一个地址改成这种格式要的写法：Anthropic 用根地址（它自己加 /v1），OpenAI 的两种用 …/v1（只有主机时补上）。
 */
export function respellUrl(input: { url: string; format: ApiEndpointRequestFormat }): string {
  const url = input.url.trim().replace(/\/+$/, "");
  if (input.format === "anthropic_messages") return url.replace(/\/v1$/, "");
  return /\/v\d+[a-z]*$/.test(url) || !/^https?:\/\/[^/]+$/.test(url) ? url : `${url}/v1`;
}

/**
 * 读一段整段粘贴的 curl 命令；不是 curl 命令为 null。续行可以是 `\`（sh）、`^`（cmd）或反引号（PowerShell），
 * 也认 `curl.exe`、引号与转义；key 依次从 `Authorization: Bearer`、`x-api-key`、`api-key` 取第一个有值的头。
 */
export function curlOf(text: string): CurlCommand | null {
  let source = text.trim();
  const head = /^curl(?:\.exe)?(?=\s)/i.exec(source);
  if (!head) return null;
  const isCmd = /\^[ \t]*\r?\n/.test(source);
  const isPowerShell = /`[ \t]*\r?\n/.test(source) || /^curl\.exe/i.test(source);
  source = source.slice(head[0].length).replace(/(?:\\|\^|`)[ \t]*\r?\n/g, " ");
  const { url, body, headers } = requestOf(shellWords({ source, isCmd, isPowerShell }));

  const command: CurlCommand = {
    url,
    format: null,
    baseUrl: null,
    urlPlaceholder: null,
    apiKey: null,
    keyPlaceholder: null,
    model: modelOf(body),
  };
  const endpoint =
    /^(https?:\/\/[^?#]*?)\/*(\/chat\/completions|\/messages|\/responses)\/*(?:[?#].*)?$/i.exec(
      url,
    );
  if (endpoint) {
    const format = ENDPOINT_FORMATS[endpoint[2].toLowerCase()];
    const baseUrl = respellUrl({ url: endpoint[1], format });
    command.format = format;
    command.baseUrl = baseUrl;
    command.urlPlaceholder = /\{[^}]*\}|<[^>]*>|\$\{?\w+\}?|%\w+%/.exec(baseUrl)?.[0] ?? null;
  }
  const key = keyOf(headers);
  if (key !== null && KEY_PLACEHOLDER.test(key)) command.keyPlaceholder = key;
  else command.apiKey = key;
  return command;
}

/** 从拆好的词里取 URL（第一个不是选项的词，或 --url）、请求头与正文（从文件读的 `@…` 不算）。 */
function requestOf(words: string[]): { url: string; body: string; headers: string[] } {
  let url = "";
  let body = "";
  const headers: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    let option = word;
    let value: string;
    if (/^-[Hd]./.test(word)) {
      option = word.slice(0, 2);
      value = word.slice(2);
    } else if (VALUED_OPTION.test(word)) {
      index++;
      value = words[index] ?? "";
    } else {
      if (!word.startsWith("-") && !url) url = word;
      continue;
    }
    if (option === "-H" || option === "--header") headers.push(value);
    else if (option === "--url") url = value;
    else if (/^(-d|--data(-raw|-binary|-ascii)?|--json)$/.test(option) && !value.startsWith("@")) {
      body = value;
    }
  }
  return { url, body, headers };
}

/** 第一个有值的 Authorization（去掉 Bearer）、x-api-key 或 api-key 头；没有为 null。 */
function keyOf(headers: string[]): string | null {
  for (const header of headers) {
    const match = /^\s*(authorization|x-api-key|api-key)\s*:\s*(.*?)\s*$/i.exec(header);
    if (!match) continue;
    const key =
      match[1].toLowerCase() === "authorization" ? match[2].replace(/^bearer\s+/i, "") : match[2];
    if (key) return key;
  }
  return null;
}

interface WordsInput {
  source: string;
  isCmd: boolean;
  isPowerShell: boolean;
}

/** 照 shell 交给 curl 的样子拆词：去掉引号、读出转义。 */
function shellWords(input: WordsInput): string[] {
  const { source } = input;
  const words: string[] = [];
  let word: string | null = null;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      if (word !== null) words.push(word);
      word = null;
      index++;
      continue;
    }
    const read =
      char === "'" || char === '"'
        ? readQuoted({ input, at: index })
        : readBare({ input, at: index });
    word = (word ?? "") + read.text;
    index = read.next;
  }
  if (word !== null) words.push(word);
  return words;
}

interface WordPiece {
  text: string;
  next: number;
}

/** 引号里的一段。单引号里原样，PowerShell 用两个单引号表示一个；双引号里认 `\` 转义，PowerShell 还认反引号。 */
function readQuoted(read: { input: WordsInput; at: number }): WordPiece {
  const { source, isPowerShell } = read.input;
  let text = "";
  if (source[read.at] === "'") {
    let from = read.at + 1;
    for (;;) {
      const close = source.indexOf("'", from);
      if (close < 0) return { text: text + source.slice(from), next: source.length };
      if (isPowerShell && source[close + 1] === "'") {
        text += `${source.slice(from, close)}'`;
        from = close + 2;
        continue;
      }
      return { text: text + source.slice(from, close), next: close + 1 };
    }
  }
  let index = read.at + 1;
  for (; index < source.length && source[index] !== '"'; index++) {
    const isEscape =
      (source[index] === "\\" && /["\\$`]/.test(source[index + 1] ?? "")) ||
      (isPowerShell && source[index] === "`");
    if (isEscape) index++;
    text += source[index] ?? "";
  }
  return { text, next: index + 1 };
}

/** 引号外的一个字符：sh 的 `\` 与 cmd 的 `^` 转义下一个字符。 */
function readBare(read: { input: WordsInput; at: number }): WordPiece {
  const { source, isCmd, isPowerShell } = read.input;
  const char = source[read.at];
  const isEscape = (char === "\\" && !isCmd && !isPowerShell) || (char === "^" && isCmd);
  if (isEscape) return { text: source[read.at + 1] ?? "", next: read.at + 2 };
  return { text: char, next: read.at + 1 };
}

/** JSON 正文里的 model；PowerShell 5 的正文常把引号写成 `\"`，两种都试。 */
function modelOf(body: string): string | null {
  for (const candidate of [body, body.replace(/\\"/g, '"')]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    if (parsed !== null && typeof parsed === "object" && "model" in parsed) {
      return typeof parsed.model === "string" ? parsed.model.trim() || null : null;
    }
    return null;
  }
  return null;
}
