// 运行 `claude auth login`、截下登录地址、粘贴代码移植自 magpie（https://github.com/yetone/magpie，d5805372）：
// internal/provider/claude_signin.go 的 startClaudeSignIn、TookOpenedURL、claudeNoLink、claudePaste。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ChildProcess } from "node:child_process";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import stripAnsi from "strip-ansi";
import type {
  ProviderAccountError,
  ProviderAccountSignIn,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import { spawnProcess } from "../../utils/spawn.js";
import { claudeEnvFor, type ClaudeCliLaunch } from "./claude-cli.js";
import { randomToken } from "./codex-oauth.js";
import { SignInFailure, SignInPasteError, type SignInKept } from "./codex-sign-in.js";

/*
 * 一次 Claude Code 加号：在这个号新的私有配置目录里后台运行真的 `claude auth login --claudeai`。
 * Osuna 充当交给它的「浏览器」（BROWSER 指向一个只把地址记进文件的小脚本），截下它要打开的登录页交给客户端；
 * 它打印的另一个登录页登录完显示一段代码，不在主机前的用户把代码粘回来，Osuna 转给它的标准输入。
 * 它登录成功退出后，keep 从这个目录读出是哪个号并存进账号存储。Osuna 不问 Anthropic 任何事。
 */

// Claude Code 要打开的地址记在这个变量指的文件里。
const OPENED_URL_ENV = "PASEO_CLAUDE_OPENED_URL";
const OPENED_URL_FILE = ".paseo-opened-url";
const BROWSER_FILE = ".paseo-browser";
// 照 magpie：打印了链接后再等这么久看它会不会打开另一个（会跳回主机的那个）。
const PRINTED_GRACE_MS = 3000;
// 已经截下要打开的页面，再等这么久拿它打印的那个（远程设备用）。
const OPENED_GRACE_MS = 1000;
const POLL_MS = 50;
// 粘贴的代码等登录结束最多这么久（magpie 一分钟）。
const SUBMIT_WAIT_MS = 60_000;
const LINK = /https:\/\/\S+/;
const PROMPT = "Paste code here if prompted >";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// 转交粘贴的地址最多等这么久（magpie 30 秒）。
const FORWARD_TIMEOUT_MS = 30_000;
// Claude 登录页显示的代码是「代码#state」。
const PASTED_CODE = /^[^#\s]+#[^#\s]+$/;

export interface ClaudeSignInOptions {
  launch: ClaudeCliLaunch;
  // 这个号的私有配置目录，已经建好（0700）。
  configDir: string;
  accountId?: string;
  timeoutMs: number;
  // 多久没给出链接算启动失败（magpie 30 秒）。
  linkWaitMs: number;
  // 「读取 CLI 登录凭证」开着；关着时登录完也不存这个号。
  allowed: () => boolean;
  // 登录成功：从 configDir 读出号存进账号存储；抛 SignInFailure 就是失败。
  keep: () => Promise<SignInKept>;
  // 没登成（失败、取消、超时）：清掉 configDir。
  discard: () => Promise<void>;
  onChange: () => void;
}

type Outcome =
  | { status: "waiting" }
  | { status: "done"; result: SignInKept }
  | { status: "failed"; error: ProviderAccountError }
  | { status: "canceled" };

export class ClaudeSignIn {
  readonly id = randomToken(9);
  private authUrl = "";
  private codeUrl: string | undefined;
  private callbackBlocked = false;
  private child: ChildProcess | null = null;
  // 还没运行（写「浏览器」小脚本时就失败）也能等。
  private exited: Promise<void> = Promise.resolve();
  // Claude Code 打开的页面登录完跳回主机的端口；没打开页面时为 null。
  private callbackPort: string | null = null;
  private exitCode: number | null = null;
  private lastSaid = "";
  // 它打印的第一个链接。
  private printed: string | null = null;
  // 给出链接之前就退出或运行不了：它最后说的话。
  private endedEarly: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private outcome: Outcome = { status: "waiting" };
  private settled!: Promise<void>;
  private settle!: () => void;

  private constructor(private readonly options: ClaudeSignInOptions) {
    this.settled = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  /** 运行 `claude auth login`，等它给出登录页；没给出（找不到、提前退出、一直不说话）就抛出，目录已清掉。 */
  static async start(options: ClaudeSignInOptions): Promise<ClaudeSignIn> {
    const signIn = new ClaudeSignIn(options);
    try {
      await signIn.begin();
    } catch (error) {
      signIn.kill();
      await signIn.exited.catch(() => undefined);
      await options.discard();
      throw error;
    }
    return signIn;
  }

  view(): ProviderAccountSignIn {
    const base = {
      id: this.id,
      provider: "claude",
      ...(this.options.accountId ? { accountId: this.options.accountId } : {}),
      authUrl: this.authUrl,
      callbackBlocked: this.callbackBlocked,
      ...(this.codeUrl ? { codeUrl: this.codeUrl } : {}),
    };
    return { ...base, ...this.outcome };
  }

  get waiting(): boolean {
    return this.outcome.status === "waiting";
  }

  cancel(): void {
    this.finish({ status: "canceled" });
  }

  dispose(): void {
    this.cancel();
  }

  /**
   * 用户粘回来的东西（照 magpie 的 claudePaste）：Claude 登录页显示的代码，照用户手打那样交给 `claude auth login`；
   * 或回不到主机的浏览器最后跳到的地址，转给在主机上等着它的 `claude auth login`。等这次登录结束再返回。
   */
  async submit(raw: string): Promise<void> {
    if (!this.waiting)
      throw new SignInPasteError("not_waiting", "This sign-in is over; start it again");
    const pasted = raw.trim();
    if (/^https?:\/\//i.test(pasted)) {
      await this.forwardCallback(pasted);
    } else if (PASTED_CODE.test(pasted)) {
      const stdin = this.child?.stdin;
      if (!stdin?.writable) {
        throw new SignInPasteError("not_waiting", "This sign-in is over; start it again");
      }
      stdin.write(`${pasted}\n`);
    } else {
      throw new SignInPasteError(
        "code_invalid",
        "Paste the code Claude's page shows, or the whole address the browser ended on",
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SUBMIT_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  private async forwardCallback(pasted: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(pasted);
    } catch {
      throw new SignInPasteError("paste_invalid", "Paste the whole address the browser ended on");
    }
    const ours =
      this.callbackPort !== null &&
      url.port === this.callbackPort &&
      LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) &&
      url.searchParams.get("code");
    if (!ours) {
      throw new SignInPasteError(
        "paste_mismatch",
        "That address isn't from this sign-in: paste the one its browser tab ended on",
      );
    }
    try {
      await fetch(`http://localhost:${this.callbackPort}${url.pathname}${url.search}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SignInPasteError(
        "forward_failed",
        `Claude Code didn't take that address: ${reason}`,
      );
    }
  }

  private async begin(): Promise<void> {
    const { launch, configDir } = this.options;
    const browser = await writeBrowser(configDir);
    const opened = path.join(configDir, OPENED_URL_FILE);
    const child = spawnProcess(launch.command, [...launch.args, "auth", "login", "--claudeai"], {
      cwd: configDir,
      env: claudeEnvFor({
        env: launch.env,
        configDir,
        extra: { BROWSER: browser, [OPENED_URL_ENV]: opened },
      }),
      envMode: "internal",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.exited = new Promise<void>((resolve) => {
      child.once("error", (error) => {
        this.endedEarly = error.message;
        resolve();
      });
      child.once("close", (code) => {
        this.exitCode = code;
        this.endedEarly ??= this.lastSaid || "claude auth login didn't finish";
        resolve();
      });
    });
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      createInterface({ input: stream }).on("line", (raw) => {
        const line = stripAnsi(raw).trim();
        const link = LINK.exec(line)?.[0];
        if (link) {
          this.printed ??= link;
          return;
        }
        const said = line.replace(PROMPT, "").trim();
        if (said) this.lastSaid = said;
      });
    }

    const openedUrl = await this.waitForLink(opened);
    this.authUrl = openedUrl ?? this.printed ?? "";
    this.codeUrl = this.printed ?? undefined;
    this.callbackBlocked = openedUrl === null;
    this.callbackPort = openedUrl === null ? null : callbackPortOf(openedUrl);
    this.timer = setTimeout(() => {
      this.finish({
        status: "failed",
        error: { code: "timed_out", message: "The sign-in timed out; start it again" },
      });
    }, this.options.timeoutMs);
    void this.exited.then(() => this.onExit());
  }

  /**
   * 等 Claude Code 给出登录页（照 magpie）：它打开的那个（返回它的地址）与它打印的那个。只打印了的，再等一会儿看它会不会
   * 打开；打开了的，再等一会儿拿它打印的。提前退出、一直不给就抛出。
   */
  private async waitForLink(opened: string): Promise<string | null> {
    const startedAt = Date.now();
    let printedAt: number | null = null;
    let openedUrl: string | null = null;
    let openedAt = 0;
    for (;;) {
      const now = Date.now();
      if (openedUrl === null) {
        const text = (await readFile(opened, "utf8").catch(() => "")).trim();
        if (text) {
          openedUrl = text;
          openedAt = now;
        }
      }
      if (this.printed !== null) printedAt ??= now;
      if (openedUrl !== null && (this.printed !== null || now - openedAt >= OPENED_GRACE_MS)) {
        return openedUrl;
      }
      if (openedUrl === null && printedAt !== null && now - printedAt >= PRINTED_GRACE_MS) {
        return null;
      }
      if (this.endedEarly !== null) throw new Error(this.endedEarly);
      if (printedAt === null && openedUrl === null && now - startedAt >= this.options.linkWaitMs) {
        throw new Error(
          this.lastSaid
            ? `claude auth login gave no link to open: ${this.lastSaid}`
            : "claude auth login gave no link to open and printed nothing",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  private async onExit(): Promise<void> {
    if (!this.waiting) return;
    if (this.exitCode !== 0) {
      this.finish({
        status: "failed",
        error: {
          code: "login_failed",
          message: this.lastSaid || "claude auth login didn't finish",
        },
      });
      return;
    }
    // 登录途中关掉了「读取 CLI 登录凭证」：不存这个号。
    if (!this.options.allowed()) {
      this.finish({
        status: "failed",
        error: { code: "cli_sign_ins_off", message: "Read CLI sign-ins was turned off" },
      });
      return;
    }
    try {
      await removeHelpers(this.options.configDir);
      const result = await this.options.keep();
      this.finish({ status: "done", result });
    } catch (error) {
      const failure =
        error instanceof SignInFailure
          ? { code: error.code, message: error.message }
          : { code: "failed", message: error instanceof Error ? error.message : String(error) };
      this.finish({ status: "failed", error: failure });
    }
  }

  private finish(outcome: Exclude<Outcome, { status: "waiting" }>): void {
    if (!this.waiting) return;
    this.outcome = outcome;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (outcome.status !== "done") {
      this.kill();
      // 等它退出再清目录，免得它退出前又写进去。
      void this.exited.then(() => this.options.discard()).catch(() => undefined);
    }
    this.settle();
    this.options.onChange();
  }

  private kill(): void {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
  }
}

/** 交给 Claude Code 的「浏览器」：只把要打开的地址记进 PASEO_CLAUDE_OPENED_URL 指的文件（magpie 的 TookOpenedURL）。 */
async function writeBrowser(configDir: string): Promise<string> {
  if (process.platform === "win32") {
    // Windows 上不截：什么都不打开，只用它打印的链接与粘贴代码。
    const file = path.join(configDir, `${BROWSER_FILE}.cmd`);
    await writeFile(file, "@exit /b 0\r\n");
    return file;
  }
  const file = path.join(configDir, BROWSER_FILE);
  await writeFile(file, `#!/bin/sh\nprintf '%s' "$1" > "$${OPENED_URL_ENV}"\n`);
  await chmod(file, 0o700);
  return file;
}

async function removeHelpers(configDir: string): Promise<void> {
  await Promise.all(
    [BROWSER_FILE, `${BROWSER_FILE}.cmd`, OPENED_URL_FILE].map((name) =>
      rm(path.join(configDir, name), { force: true }),
    ),
  );
}

/** Claude 登录页把浏览器送回本机的端口（redirect_uri 指向本机时）；别的为 null（magpie 的 claudeCallbackPort）。 */
function callbackPortOf(link: string): string | null {
  try {
    const redirect = new URL(new URL(link).searchParams.get("redirect_uri") ?? "");
    return LOOPBACK_HOSTS.has(redirect.hostname.toLowerCase()) ? redirect.port : null;
  } catch {
    return null;
  }
}
