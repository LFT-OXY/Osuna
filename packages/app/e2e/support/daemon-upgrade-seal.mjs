/*
 * e2e 测试 daemon 的封条：经 NODE_OPTIONS=--import 预加载进 daemon 及它派生的 Node 进程。
 *
 * 1. 不查 npm registry 的最新版本：设置页就不会出现「Upgrade to …」按钮（版本检查按查不到处理）。
 * 2. 即使有人直接发 provider.upgrade，也不会碰本机的 CLI 安装：Agent CLI 的 update / upgrade 子命令、
 *    brew 的安装与升级、包管理器的全局安装、官方安装脚本，一律换成一个立刻以 1 退出的 node 进程，并记一行到
 *    PASEO_E2E_UPGRADE_RECORD_PATH（设了的话）。
 *
 * 3. 不起真的 Codex 判断登录方式：第三方接口打开 Codex 开关、读状态时会起一个临时 app-server 问 account/read
 *    （带 `-c model_provider="openai"`），同样换成立刻以 1 退出的进程，daemon 按「判断不出」保持现在的接法。
 *
 * 4. 不起开发者真实的登录 shell：查 Claude Code 云平台开关时问登录 shell 的进程（带 PASEO_SHELL_PROBE=1）
 *    同样换掉，daemon 按没问到处理。
 *
 * 5. 不读本机真实的进程表、进程的环境，不找、不跑真的 codex：第三方接口「改完提示要重开谁」的「进程与命令」适配器
 *    （host-processes.ts）换成这里装上的假的：进程表读 PASEO_E2E_PROCESS_TABLE_PATH 文件（ps 的格式，没设就是空的），
 *    CODEX_HOME 一律读不到，codex 就叫 codex，执行的命令只记一行到 PASEO_E2E_UPGRADE_RECORD_PATH、以 0 结束；
 *    系统代理读 PASEO_E2E_SYSTEM_PROXY_PATH 文件（SystemProxy 的 JSON，没设或没有这个文件就是没设代理），
 *    不跑 scutil、不读注册表。
 *
 * 7. 不上外网取图片：第三方接口取网站图标、导入链接的 icon= 图片都经这里装上的假外网（site-icon.ts 的
 *    sealedFetchSite）。网址到回复写在 PASEO_E2E_FAKE_SITES_PATH 文件里（{ 网址: { status, body } }，body 是文本），
 *    没设、没有这个文件或没写这个网址的一律抛错，绝不真的去取。
 *
 * 6. 不带开发者的代理：daemon 自己的 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY、NO_PROXY（各种大小写）在这里删掉，
 *    查 Codex 经哪个代理时只会读到用例给的假系统代理（上面第 5 条）。spawn-node.ts 的 withUpgradeSeal 同样会删。
 *
 * 8. 不带着 key 去问真的厂商（也不问真的汇率网站）：第三方接口读余额的厂商（balance.ts 的厂商表）的 API 主机，daemon 的 fetch 一律不真的去
 *    （读余额、保存后拉模型清单都是）。PASEO_E2E_FAKE_SITES_PATH 里写了这个网址的，回那里写的回复（JSON）；
 *    没写的当作连不上。厂商表加了新厂商，这里跟着加。
 *
 * 9. 不读本机真实的钥匙串：多号自动轮换读 CLI 登录用的钥匙串（provider-accounts/keychain.ts）换成这里装上的假的，
 *    内容读写 PASEO_E2E_KEYCHAIN_PATH 文件（{ "服务名\u0000账号": 内容 }，没设或没有这个文件就是空的；
 *    没设时写进内存），绝不跑 `security`。
 *
 * 10. Codex 加号不占本机的 1455、不连 OpenAI：回调端口换成随便一个空端口（provider-accounts/service.ts 的
 *     SEALED_CODEX_CALLBACK_PORT），换 token 与续期（https://auth.openai.com/oauth/token）由上面第 8 条的假外网回答。
 *
 * 2026-10-18 一条浏览器用例点中了升级按钮，测试 daemon 真的跑了 `brew upgrade --cask claude-code@latest`
 * 又被中途杀掉，弄坏了开发者本机的 Claude Code。
 */
import childProcess from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const NPM_REGISTRY = "https://registry.npmjs.org/";
// 带自升级子命令的 Agent CLI（provider-upgrade-command.ts 的表，外加 Codex）。
const AGENT_CLIS = new Set(["claude", "codex", "copilot", "opencode", "pi", "omp"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const INSTALL_VERBS = new Set(["install", "i", "add", "update", "upgrade", "reinstall"]);

// 读余额的厂商的 API 主机（packages/server/src/server/api-endpoints/balance.ts 的 BALANCE_VENDORS），
// 与读套餐窗口的厂商（balance-plan.ts 的 PLAN_VENDOR_URLS）。
const SEALED_VENDOR_ORIGINS = [
  "https://api.deepseek.com/",
  "https://api.moonshot.cn/",
  "https://api.moonshot.ai/",
  "https://openrouter.ai/",
  "https://api.siliconflow.cn/",
  "https://api.siliconflow.com/",
  "https://api.stepfun.com/",
  "https://api.stepfun.ai/",
  "https://api.commandcode.ai/",
  "https://ollama.com/",
  "https://aihubmix.com/",
  "https://open.bigmodel.cn/",
  // 智谱团队套餐的第二个站点（balance-plan.ts 的 glm_cn_biz）。
  "https://bigmodel.cn/",
  "https://api.z.ai/",
  "https://api.kimi.com/",
  "https://api.kimi.ai/",
  "https://api.minimaxi.com/",
  "https://api.minimax.io/",
  "https://opencode.ai/",
  // 火山方舟与腾讯云的开放平台（balance-plan.ts 的 volcengine_open、tencent_open）：带的是云账号密钥的签名。
  "https://open.volcengineapi.com/",
  "https://tokenhub.tencentcloudapi.com/",
  // 用例里火山方舟、腾讯云 Token Plan 接口自己的地址：打开详情页会拉模型清单，带着 key 去问。
  "https://ark.cn-beijing.volces.com/",
  "https://tokenhub.tencentmaas.com/",
  // Codex 的套餐用量与重置卡（plugins/codex-usage-source）：测试的 CODEX_HOME 是空的不会去问，这里兜底。
  "https://chatgpt.com/",
  // Codex 加号换 token、存着的号续期（provider-accounts/codex-oauth.ts）。
  "https://auth.openai.com/",
  // 人民币显示用的汇率（usage/exchange-rate.ts）：价格表自动更新开着又选了人民币才会去问，这里兜底。
  "https://open.er-api.com/",
];

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (url.startsWith(NPM_REGISTRY)) {
      return Promise.resolve(new Response("sealed by the e2e harness", { status: 404 }));
    }
    if (SEALED_VENDOR_ORIGINS.some((origin) => url.startsWith(origin))) {
      return sealedVendorReply(url);
    }
    return realFetch(input, init);
  };
}

function commandName(command) {
  return path
    .basename(String(command))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/**
 * Agent CLI 的可执行文件：升级时用它实际启动的那个，可能是解析过符号链接的真实路径
 * （~/.local/share/claude/versions/2.1.x、Caskroom/claude-code@latest/…），所以看路径里的每一段。
 */
function isAgentCli(command) {
  const segments = String(command).toLowerCase().split(/[\\/]/);
  return segments.some((segment) => {
    const name = segment.replace(/\.(exe|cmd|bat|ps1)$/, "");
    return [...AGENT_CLIS].some(
      (cli) => name === cli || name.startsWith(`${cli}-`) || name.startsWith(`${cli}@`),
    );
  });
}

/** 会改本机 CLI 安装的命令：Agent CLI 的 update / upgrade、brew 装与升级、包管理器的全局安装、官方安装脚本。 */
export function isGlobalInstallCommand(command, args) {
  const name = commandName(command);
  const list = Array.isArray(args) ? args.map(String) : [];
  if (isAgentCli(command)) return list[0] === "update" || list[0] === "upgrade";
  if (name === "brew") return list.some((arg) => INSTALL_VERBS.has(arg));
  if (PACKAGE_MANAGERS.has(name)) {
    const isGlobal = list.includes("-g") || list.includes("--global") || list[0] === "global";
    return isGlobal && list.some((arg) => INSTALL_VERBS.has(arg));
  }
  return list.some((arg) => /chatgpt\.com\/codex\/install\.(sh|ps1)/.test(arg));
}

/**
 * 第三方接口判断 Codex 登录方式时起的临时 app-server（codex-sign-in.ts）。只看参数：
 * Codex 也可能经 node 跑 npm 包里的脚本，可执行文件不一定叫 codex。
 */
export function isCodexSignInProbe(_command, args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  return list.includes("app-server") && list.includes('model_provider="openai"');
}

/** 查 Claude Code 云平台开关时问登录 shell 的进程（login-shell-env.ts 带 PASEO_SHELL_PROBE=1）。 */
export function isLoginShellProbe(options) {
  return options?.env?.PASEO_SHELL_PROBE === "1";
}

/** ps 的 etime（[[dd-]hh:]mm:ss）换成秒；读不出为 null。 */
function elapsedSeconds(text) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    ((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes)) * 60 + Number(seconds)
  );
}

/** PASEO_E2E_PROCESS_TABLE_PATH 里「pid 父 pid 已运行时间 命令行」的假进程表。 */
function readFakeProcessTable() {
  const file = process.env.PASEO_E2E_PROCESS_TABLE_PATH;
  if (!file || !existsSync(file)) return [];
  const now = Date.now();
  const processes = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    const elapsed = match ? elapsedSeconds(match[3]) : null;
    if (elapsed === null) continue;
    processes.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      startedAt: new Date(now - elapsed * 1000),
      commandLine: match[4].trim(),
    });
  }
  return processes;
}

const PROXY_VARS = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]);
for (const key of Object.keys(process.env)) {
  if (PROXY_VARS.has(key.toUpperCase())) delete process.env[key];
}

const NO_SYSTEM_PROXY = { url: null, http: null, socks: null, bypass: [] };

/** PASEO_E2E_SYSTEM_PROXY_PATH 里的假系统代理。 */
function readFakeSystemProxy() {
  const file = process.env.PASEO_E2E_SYSTEM_PROXY_PATH;
  if (!file || !existsSync(file)) return NO_SYSTEM_PROXY;
  return { ...NO_SYSTEM_PROXY, ...JSON.parse(readFileSync(file, "utf8")) };
}

globalThis[Symbol.for("paseo.e2e.hostProcesses")] = {
  reportsStartTimes: true,
  list: async () => readFakeProcessTable(),
  readCodexHome: async () => null,
  findCodex: async ({ env }) => ({ command: "codex", args: [], env: { ...process.env, ...env } }),
  run: async (command) => {
    const record = process.env.PASEO_E2E_UPGRADE_RECORD_PATH;
    if (record) {
      const entry = { command: command.command, args: command.args, at: Date.now() };
      appendFileSync(record, `${JSON.stringify(entry)}\n`);
    }
    return { exitCode: 0, output: "" };
  },
  readSystemProxy: async () => readFakeSystemProxy(),
};

globalThis[Symbol.for("paseo.e2e.codexCallbackPort")] = 0;

const memoryKeychain = {};

function readFakeKeychain() {
  const file = process.env.PASEO_E2E_KEYCHAIN_PATH;
  if (!file) return memoryKeychain;
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

globalThis[Symbol.for("paseo.e2e.cliKeychain")] = {
  available: true,
  read: async (service, account) => readFakeKeychain()[`${service}\u0000${account}`] ?? null,
  write: async (service, account, value) => {
    const items = readFakeKeychain();
    items[`${service}\u0000${account}`] = value;
    const file = process.env.PASEO_E2E_KEYCHAIN_PATH;
    if (file) writeFileSync(file, JSON.stringify(items));
  },
};

function readFakeSites() {
  const file = process.env.PASEO_E2E_FAKE_SITES_PATH;
  return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/** 封住的厂商网址：PASEO_E2E_FAKE_SITES_PATH 写了的回那里的，没写的连不上。 */
function sealedVendorReply(url) {
  const site = readFakeSites()[url];
  if (!site) return Promise.reject(new TypeError("fetch failed: sealed by the e2e harness"));
  return Promise.resolve(
    new Response(site.body, {
      status: site.status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** PASEO_E2E_FAKE_SITES_PATH 里的假站点；没写的网址抛错。 */
globalThis[Symbol.for("paseo.e2e.fetchSite")] = async ({ url }) => {
  const site = readFakeSites()[url];
  if (!site)
    throw new Error(`The e2e daemon never fetches ${url}: add it to PASEO_E2E_FAKE_SITES_PATH`);
  return { status: site.status, url, body: Buffer.from(site.body) };
};

const realSpawn = childProcess.spawn;
childProcess.spawn = function sealedSpawn(command, args, options) {
  const spawnOptionsOf = Array.isArray(args) ? options : args;
  const isSealed =
    isGlobalInstallCommand(command, args) ||
    isCodexSignInProbe(command, args) ||
    isLoginShellProbe(spawnOptionsOf);
  if (!isSealed) {
    return realSpawn.apply(this, arguments);
  }
  const record = process.env.PASEO_E2E_UPGRADE_RECORD_PATH;
  if (record) {
    appendFileSync(record, `${JSON.stringify({ command, args, at: Date.now() })}\n`);
  }
  const spawnOptions = Array.isArray(args) ? options : args;
  return realSpawn(
    process.execPath,
    ["-e", "process.stderr.write('blocked by the e2e upgrade seal\\n'); process.exit(1)"],
    { ...spawnOptions, shell: false },
  );
};
syncBuiltinESMExports();
