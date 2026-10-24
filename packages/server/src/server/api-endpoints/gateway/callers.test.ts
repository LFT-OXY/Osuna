// 用例取自 magpie（https://github.com/yetone/magpie）：internal/gateway/lan_rebind_test.go（TestReboundPageRefused）、
// cors_test.go（TestForeignPagesRefused、TestOpaqueOriginNeedsAKey、TestLocalhostSubdomainNeedsAKey）、
// lan_proxy_test.go、lan_test.go（TestAgentOf）与 internal/agent/useragent_test.go
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import { judgeCaller, type CallerVerdict } from "./callers.js";

const TOKENS = {
  claude: "token-claude-0123456789",
  codex: "token-codex-0123456789",
  pi: "token-pi-0123456789",
  omp: "token-omp-0123456789",
};
const LOOP = "127.0.0.1";
const CHROME = {
  "user-agent": "Mozilla/5.0 (Macintosh) Chrome/140",
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
};
const EVIL_HOST = "rebind.attacker.example:6767";

function judge(
  headers: IncomingHttpHeaders,
  options: { remoteAddress?: string; platform?: NodeJS.Platform } = {},
): CallerVerdict {
  return judgeCaller({
    remoteAddress: options.remoteAddress ?? LOOP,
    headers: { host: "127.0.0.1:6767", ...headers },
    tokens: TOKENS,
    machineName: "my-mac.local",
    platform: options.platform ?? "darwin",
  });
}

function refused(verdict: CallerVerdict): boolean {
  return verdict.kind === "refused";
}

function agentOf(verdict: CallerVerdict) {
  if (verdict.kind !== "accepted") throw new Error(`refused: ${verdict.message}`);
  return verdict.agent;
}

describe("who is local", () => {
  it("takes any loopback address, IPv4-mapped included", () => {
    for (const remoteAddress of ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"]) {
      expect(refused(judge({}, { remoteAddress }))).toBe(false);
    }
  });

  it("refuses another machine, whatever token it brings", () => {
    const verdict = judge(
      { authorization: `Bearer ${TOKENS.claude}` },
      { remoteAddress: "192.168.1.9" },
    );
    expect(verdict).toMatchObject({ kind: "refused", status: 403 });
  });

  it("refuses a request any proxy or tunnel passed on, with or without the token", () => {
    for (const name of [
      "forwarded",
      "x-forwarded-for",
      "x-real-ip",
      "cf-connecting-ip",
      "true-client-ip",
      "tailscale-user-login",
    ]) {
      expect(refused(judge({ [name]: "203.0.113.9" })), name).toBe(true);
      expect(
        refused(judge({ [name]: "203.0.113.9", authorization: `Bearer ${TOKENS.codex}` })),
        name,
      ).toBe(true);
    }
    // 空的转发头不算经过代理（magpie 用 Header.Get 判断）。
    expect(refused(judge({ "x-forwarded-for": "" }))).toBe(false);
  });
});

describe("pages a browser sends", () => {
  it("refuses a page whose site's name was pointed at this computer (DNS rebinding)", () => {
    expect(refused(judge({ host: EVIL_HOST, ...CHROME }))).toBe(true);
    expect(refused(judge({ host: EVIL_HOST, origin: `http://${EVIL_HOST}`, ...CHROME }))).toBe(
      true,
    );
    // 没有 Sec-Fetch 的旧 Safari：只看 User-Agent。
    expect(
      refused(judge({ host: EVIL_HOST, "user-agent": "Mozilla/5.0 (Macintosh) Safari/605" })),
    ).toBe(true);
    // localhost 的子域名 Safari 会去问 DNS。
    expect(refused(judge({ host: "wails.localhost", ...CHROME }))).toBe(true);
  });

  it("answers a browser that calls it by an address or name of this computer", () => {
    for (const host of [
      "127.0.0.1:6767",
      "localhost:6767",
      "[::1]:6767",
      "host.docker.internal:6767",
      "LOCALHOST.:6767",
      "my-mac:6767",
      "my-mac.local:6767",
    ]) {
      expect(refused(judge({ host, ...CHROME })), host).toBe(false);
    }
  });

  it("answers an agent under any name, and a rebound page that knows a token", () => {
    expect(refused(judge({ host: EVIL_HOST, "user-agent": "claude-cli/2.1.302" }))).toBe(false);
    expect(
      refused(judge({ host: EVIL_HOST, authorization: `Bearer ${TOKENS.claude}`, ...CHROME })),
    ).toBe(false);
    expect(
      refused(judge({ host: EVIL_HOST, authorization: "Bearer not-a-token", ...CHROME })),
    ).toBe(true);
  });

  it("refuses a web page elsewhere, even with a token", () => {
    for (const origin of [
      "https://evil.example",
      "http://evil.example:6767",
      "http://localhost.evil.example",
      "http://192.168.1.7:3000",
      "HTTPS://Evil.Example",
    ]) {
      expect(refused(judge({ origin })), origin).toBe(true);
      expect(refused(judge({ origin, authorization: `Bearer ${TOKENS.claude}` })), origin).toBe(
        true,
      );
    }
  });

  it("refuses a sandboxed frame or a localhost subdomain page unless it carries a token", () => {
    expect(refused(judge({ origin: "null" }))).toBe(true);
    expect(refused(judge({ origin: "null", "x-api-key": TOKENS.codex }))).toBe(false);
    expect(refused(judge({ origin: "http://tauri.localhost" }))).toBe(true);
    expect(refused(judge({ origin: "http://app.localhost:5173" }))).toBe(true);
    expect(
      refused(judge({ origin: "http://app.localhost", authorization: `Bearer ${TOKENS.claude}` })),
    ).toBe(false);
    // Windows 上 Tauri、Wails 的 webview 自己就叫这两个名字。
    expect(refused(judge({ origin: "http://tauri.localhost" }, { platform: "win32" }))).toBe(false);
  });

  it("answers pages on this computer, its own origin, and schemes only apps send", () => {
    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.2:8080",
      "http://[::1]:3000",
      "http://127.0.0.1:6767",
      "app://cherry",
      "file://",
      "tauri://localhost",
      "vscode-webview://1abc",
      "chrome-extension://abcdefghijklmnop",
    ]) {
      expect(refused(judge({ origin })), origin).toBe(false);
    }
    // 请求自己的源：按端口比较，https 缺省 443；这个名字不是本机的，没有口令就是重绑定。
    const own = { host: "osuna.example:443", origin: "https://osuna.example" };
    expect(refused(judge({ ...own, authorization: `Bearer ${TOKENS.claude}` }))).toBe(false);
    expect(refused(judge(own))).toBe(true);
  });
});

describe("which agent is calling", () => {
  it("is the one whose token it carries, in either header", () => {
    expect(agentOf(judge({ authorization: `Bearer ${TOKENS.codex}` }))).toBe("codex");
    expect(agentOf(judge({ "x-api-key": TOKENS.claude }))).toBe("claude");
    // 两个头里放了不同的值：认得的那个算数（magpie callerKeys）。
    expect(
      agentOf(
        judge({
          authorization: "Bearer stale-placeholder",
          "x-api-key": TOKENS.codex,
          "user-agent": "claude-cli/2.1.302",
        }),
      ),
    ).toBe("codex");
  });

  it("tells Pi and Oh My Pi apart by their own tokens, whatever User-Agent they send", () => {
    expect(agentOf(judge({ authorization: `Bearer ${TOKENS.pi}` }))).toBe("pi");
    expect(agentOf(judge({ "x-api-key": TOKENS.omp, "user-agent": "pi/1.4.0" }))).toBe("omp");
    expect(agentOf(judge({ authorization: `Bearer ${TOKENS.pi}`, "user-agent": "omp/18" }))).toBe(
      "pi",
    );
  });

  it("is told by its User-Agent when the token is not one of ours", () => {
    const chatGptToken = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
    const claudeAiToken = "sk-ant-oat01-abcdefghijklmnop";
    const cases: Array<[IncomingHttpHeaders, string | null]> = [
      [{ "user-agent": "claude-cli/2.1.302 (external, cli)" }, "claude"],
      [
        {
          "user-agent": "claude-cli/2.1.302 (external, cli)",
          authorization: `Bearer ${claudeAiToken}`,
        },
        "claude",
      ],
      [{ "user-agent": "claude-code/1.0" }, "claude"],
      [{ "user-agent": "cc" }, "claude"],
      [{ "user-agent": "codex_cli_rs/0.130.0 (Mac OS 26.0; arm64)" }, "codex"],
      [{ "user-agent": "codex_cli_rs/0.130.0", authorization: `Bearer ${chatGptToken}` }, "codex"],
      [{ "user-agent": "Codex_VSCode/0.130.0" }, "codex"],
      [{ "user-agent": "acp-extension-codex/1.0" }, "codex"],
      [{ "user-agent": "codex" }, "codex"],
      [{ "user-agent": "pi/1.4.0" }, "pi"],
      [{ "user-agent": "omp/18.12.6" }, "omp"],
      [{ "user-agent": "oh-my-pi/18.12.6" }, "omp"],
      [{ "user-agent": "pi-desktop/1.0" }, null],
      [{ "user-agent": "curl/8.4.0" }, null],
      [{ "user-agent": "" }, null],
      [{}, null],
    ];
    for (const [headers, want] of cases) {
      expect(agentOf(judge(headers)), JSON.stringify(headers)).toBe(want);
    }
  });
});
