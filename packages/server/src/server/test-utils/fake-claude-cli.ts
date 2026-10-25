import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * 假的 Claude Code：只回答多号轮换会跑的两条命令，绝不运行真的 claude。
 * - `auth login --claudeai`：像真的那样在 CLAUDE_CONFIG_DIR 里登录。先打印要用户手动打开的链接（登录完页面显示
 *   一段代码），再用 $BROWSER 打开另一个会跳回本机端口的链接。浏览器回到 http://localhost:<端口>/callback?code=…，
 *   或往标准输入粘进「代码#state」，就把登录写进该目录（.credentials.json 与 .claude.json）并以 0 结束。
 * - `auth status --json`：读该目录里的登录，回邮箱与套餐；state.statusEmail 给了就回它（.claude.json 没记邮箱时）。
 * - `-p /usage --output-format json …`：读该目录里的登录，按邮箱回 state.usage 里的那段文字（JSON 的 result）。
 * 行为由 FAKE_CLAUDE_STATE 指向的 JSON 决定，每次运行重读；每次运行记一行到 FAKE_CLAUDE_LOG。
 */

export interface FakeClaudeAccount {
  accountUuid: string;
  organizationUuid: string;
  // 不给就是登录后没记下邮箱。
  email?: string;
  plan?: string;
}

export interface FakeClaudeState {
  // 下一次 `auth login` 登成的号。
  login?: FakeClaudeAccount;
  // normal：照常；no_browser：不用 $BROWSER 打开，只打印链接；silent：什么都不打印，一直等着；
  // fail：打印 failMessage 后以 1 结束。
  loginMode?: "normal" | "no_browser" | "silent" | "fail";
  failMessage?: string;
  // 按邮箱给 /usage 的输出文字；revoked 列出的号回「未登录」。
  usage?: Record<string, string>;
  revoked?: string[];
  // `auth status --json` 回的邮箱。
  statusEmail?: string;
}

export interface FakeClaudeRun {
  args: string[];
  cwd: string;
  configDir: string | null;
  browser: string | null;
}

export interface FakeClaudeCli {
  command: string;
  env: Record<string, string>;
  setState(state: FakeClaudeState): Promise<void>;
  runs(): Promise<FakeClaudeRun[]>;
}

const SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const statePath = process.env.FAKE_CLAUDE_STATE;
const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const args = process.argv.slice(2);
const configDir = process.env.CLAUDE_CONFIG_DIR || null;
if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    JSON.stringify({ args, cwd: process.cwd(), configDir, browser: process.env.BROWSER || null }) + "\n",
  );
}

function signIn(account) {
  fs.writeFileSync(
    path.join(configDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "access-" + account.accountUuid,
        refreshToken: "refresh-" + account.accountUuid,
        expiresAt: Date.now() + 3600000,
        subscriptionType: account.plan || "pro",
      },
    }),
  );
  const oauthAccount = { accountUuid: account.accountUuid, organizationUuid: account.organizationUuid };
  if (account.email) oauthAccount.emailAddress = account.email;
  fs.writeFileSync(path.join(configDir, ".claude.json"), JSON.stringify({ oauthAccount }));
}

if (args[0] === "auth" && args[1] === "login") {
  const mode = state.loginMode || "normal";
  if (mode === "fail") {
    console.log(state.failMessage || "Login failed");
    process.exit(1);
  }
  if (mode === "silent") {
    setInterval(() => {}, 1000);
  } else {
    const stateToken = "st" + process.pid;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      signIn(state.login);
      console.log("Login successful.");
      process.exit(0);
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/callback" && url.searchParams.get("code")) {
        res.writeHead(302, { location: "https://platform.claude.com/oauth/code/success" }).end();
        finish();
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      console.log("Opening browser to sign in…");
      console.log("If the browser didn't open, visit: https://claude.ai/oauth/authorize?code=true&state=" + stateToken);
      if (mode !== "no_browser" && process.env.BROWSER) {
        const opened = "https://claude.ai/oauth/authorize?state=" + stateToken +
          "&redirect_uri=" + encodeURIComponent("http://localhost:" + port + "/callback");
        spawn(process.env.BROWSER, [opened], { stdio: "ignore" });
      }
      process.stdout.write("Paste code here if prompted > ");
    });
    let typed = "";
    process.stdin.on("data", (chunk) => {
      typed += chunk.toString();
      const line = typed.split("\n")[0];
      if (!typed.includes("\n")) return;
      if (/^[^#\s]+#[^#\s]+$/.test(line.trim())) finish();
      else {
        console.log("Invalid code");
        process.exit(1);
      }
    });
  }
} else if (args[0] === "auth" && args[1] === "status") {
  let account = {};
  let oauth = {};
  try {
    account = JSON.parse(fs.readFileSync(path.join(configDir, ".claude.json"), "utf8")).oauthAccount || {};
    oauth = JSON.parse(fs.readFileSync(path.join(configDir, ".credentials.json"), "utf8")).claudeAiOauth || {};
  } catch {}
  console.log(JSON.stringify({
    loggedIn: Boolean(oauth.accessToken),
    email: state.statusEmail || account.emailAddress || null,
    subscriptionType: oauth.subscriptionType || null,
  }));
} else if (args[0] === "-p" && args[1] === "/usage") {
  let email = null;
  try {
    email = JSON.parse(fs.readFileSync(path.join(configDir, ".claude.json"), "utf8")).oauthAccount.emailAddress;
  } catch {}
  const signedIn = fs.existsSync(path.join(configDir, ".credentials.json"));
  const revoked = !signedIn || (state.revoked || []).includes(email);
  const result = revoked
    ? { type: "result", is_error: true, result: "Not logged in · Please run /login" }
    : { type: "result", is_error: false, result: (state.usage || {})[email] || "" };
  console.log(JSON.stringify(result));
} else {
  console.error("fake claude: unexpected arguments " + args.join(" "));
  process.exit(2);
}
`;

/**
 * 在 dir 下放一个假的 claude；env 交给 daemon 的提供方环境，让假程序找到状态与记录文件。
 * 同步写：浏览器测试要在测试 daemon 启动前放好。
 */
export function createFakeClaudeCli(dir: string): FakeClaudeCli {
  mkdirSync(dir, { recursive: true });
  const command = path.join(dir, "claude");
  const statePath = path.join(dir, "state.json");
  const logPath = path.join(dir, "runs.jsonl");
  writeFileSync(command, `#!${process.execPath}\n${SCRIPT}`);
  chmodSync(command, 0o755);
  writeFileSync(statePath, "{}");
  return {
    command,
    env: { FAKE_CLAUDE_STATE: statePath, FAKE_CLAUDE_LOG: logPath },
    setState: (state) => writeFile(statePath, JSON.stringify(state)),
    async runs() {
      const text = await readFile(logPath, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FakeClaudeRun);
    },
  };
}
