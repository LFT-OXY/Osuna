// 文案取自 packages/app/src/i18n/resources/zh-CN.ts（见 research/ui-tokens.md §8）；
// 标 NEW 的是本次重排新增的文案，实现时要补进 9 种语言。
const T = {
  providers: "Providers",
  addProvider: "添加 Provider",
  addProviderA11y: "添加 Provider",
  models: (n) => (n === 1 ? "1 个 Model" : `${n} 个 Model`),
  modelsSection: "Models", // NEW：模型节标题
  status: { disabled: "已禁用", loading: "正在加载", error: "错误", available: "可用", notInstalled: "未安装" },
  apiEndpointLine: (name) => `第三方接口：${name}`, // NEW：列表行状态文字
  refresh: "刷新",
  refreshing: "正在刷新...",
  diagnostic: "诊断",
  runDiagnostic: "运行诊断", // NEW
  diagnosticHint: (name) => `查看 ${name} 的命令来源、解析路径、版本和可用状态。`, // NEW
  diagnosticRanAt: "刚刚运行", // NEW
  copyDiagnostic: "复制诊断",
  removeProvider: "Remove provider",
  searchModels: "搜索 Models",
  discovered: "已发现",
  custom: "自定义 Models",
  addModel: "添加 Model",
  modelIdPlaceholder: "例如 openai/gpt-5",
  add: "添加",
  cancel: "取消",
  updated: (t) => `已更新 ${t}`,
  noneDetected: "未检测到 Model",
  disabledHint: "已禁用。启用后 Osuna 才会检测它的 Models。", // NEW
  install: {
    title: (n) => `安装 ${n}`,
    hostHint: "在运行 Osuna daemon 的机器上执行",
    choosePlatform: "选择 Host 的操作系统",
    copy: "复制",
    docs: "官方文档",
  },
  ep: {
    title: "第三方接口",
    add: "添加",
    official: "官方",
    officialHint: (n) => `沿用 ${n} 自身的配置，通常是订阅登录`,
    inUse: "使用中",
    use: "使用",
    modelCount: (n) => `${n} 个模型`,
    inheritedTitle: (n) => `也会走 Claude Code 启用的第三方接口 ${n}`,
    inheritedDesc: "Claude 的 settings.json 里的 env 优先于这个提供方的环境变量。",
  },
  errorTitle: (n) => `${n} 无法启动`, // NEW
  catalogTitle: "添加 provider",
  catalogSearch: "搜索 providers",
  installInstructions: "安装说明",
  copied: (l) => `已复制 ${l}`,
};

const HOST_PLATFORM = "macos"; // 主机 hostPlatform = darwin

// 真实模型清单：dev daemon `paseo provider models <id>`（2026-09-30）
const CLAUDE_OFFICIAL_MODELS = [
  ["Opus 5.5", "claude-opus-5-5", "Opus 5.5 · Latest release"],
  ["Opus 5", "claude-opus-5", "Opus 5 · Previous release"],
  ["Fable 5.1", "claude-fable-5-1", "Fable 5.1 · Most powerful model"],
  ["Sonnet 5", "claude-sonnet-5", "Sonnet 5 · Best for everyday tasks"],
  ["Haiku 4.5", "claude-haiku-4-5", "Haiku 4.5 · Fastest for quick answers"],
];
const CODEX_MODELS = [
  "gpt-6-sol", "gpt-6-astra", "gpt-image-2.5-flare", "gpt-5.5", "gpt-image-1.5", "gpt-image-2",
  "gpt-image-2.5-sunburst", "gpt-6-luna", "gpt-5.6-terra", "gpt-image-2.5", "gpt-5.6-luna", "gpt-5.6-sol",
].map((id) => [id, id, ""]);

const CODEX_DIAGNOSTIC = `Codex
  Command source: default
  Configured command: codex
  Daemon PATH: /Users/oxy/.nvm/versions/node/v24.15.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
  Daemon shell: /bin/zsh
  PATH matches: /opt/homebrew/bin/codex
  which -a codex: /opt/homebrew/bin/codex
  zsh -lc type -a codex: codex is /opt/homebrew/bin/codex
  Binary: codex
  Resolved path: /opt/homebrew/bin/codex
  Version: codex-cli 0.156.1
  Models: 12
  Status: Ready`;

const PROVIDERS = [
  {
    id: "claude", label: "Claude", icon: "p-claude", enabled: true, status: "ready", updated: "22s ago",
    endpoints: {
      active: "openrouter",
      list: [
        { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api", count: 8 },
        { id: "zhipu", name: "智谱 GLM", url: "https://open.bigmodel.cn/api/anthropic", count: 3 },
      ],
    },
    // 第三方接口启用时，models 就是勾选的模型（isModelListAuthoritative）
    models: [
      "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1", "anthropic/claude-sonnet-5", "anthropic/claude-haiku-4.5",
      "z-ai/glm-5.1", "moonshotai/kimi-k3", "deepseek/deepseek-v4-pro", "qwen/qwen3.8-coder",
    ].map((id) => [id, id, ""]),
    custom: [],
  },
  {
    id: "codex", label: "Codex", icon: "p-codex", enabled: true, status: "ready", updated: "16s ago",
    endpoints: { active: null, list: [{ id: "chinhae", name: "chinhae", url: "https://chinhae.cc/v1", count: 12 }] },
    models: CODEX_MODELS,
    custom: [["gpt-5.6-sol-long", "gpt-5.6-sol-long", ""]],
    diagnostic: CODEX_DIAGNOSTIC,
  },
  { id: "copilot", label: "Copilot", icon: "p-copilot", enabled: false, status: "unavailable", models: [], custom: [] },
  {
    id: "opencode", label: "OpenCode", icon: "p-opencode", enabled: true, status: "error", models: [], custom: [],
    error: "opencode exited with code 1: Error: Unable to connect to the OpenCode server at http://127.0.0.1:4096 (ECONNREFUSED)",
  },
  {
    id: "pi", label: "Pi", icon: "p-pi", enabled: true, status: "unavailable", models: [], custom: [],
    install: {
      docs: "https://pi.dev/docs/latest/quickstart",
      macos: [{ cmd: "curl -fsSL https://pi.dev/install.sh | sh" }],
      linux: [{ cmd: "curl -fsSL https://pi.dev/install.sh | sh" }],
      windows: [{ tag: "npm", cmd: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent" }],
    },
  },
  { id: "omp", label: "Oh My Pi", icon: "p-omp", enabled: false, status: "unavailable", models: [], custom: [] },
  {
    id: "zai", label: "GLM (Z.AI)", icon: "bot", enabled: true, status: "ready", source: "custom", extends: "claude", updated: "1m ago",
    models: [
      ["GLM-5.1", "glm-5.1", "Z.AI · Flagship coding model"],
      ["GLM-5 Air", "glm-5-air", "Z.AI · Fast and low cost"],
      ["GLM-4.7", "glm-4.7", "Z.AI · Previous release"],
    ],
    custom: [["glm-5.1-long", "glm-5.1-long", ""]],
  },
];

// 真实 ACP 目录（dev daemon，2026-09-30）
const CATALOG = [
  { name: "Agoragentic", ver: "1.3.6", desc: "Agent marketplace with 174+ AI capabilities. Browse, invoke, and pay for agent services settled in USDC on Base L2.", icon: "acp-0" },
  { name: "Amp", ver: "0.7.0", desc: "ACP wrapper for Amp - the frontier coding agent", icon: "acp-1" },
  { name: "Auggie CLI", ver: "0.33.0", desc: "Augment Code's powerful software agent, backed by industry-leading context engine", icon: "acp-2" },
  { name: "Autohand Code", ver: "0.2.1", desc: "Autohand Code - AI coding agent powered by Autohand AI", icon: "acp-3" },
  { name: "Cline", ver: "3.0.46", desc: "Autonomous coding agent CLI - capable of creating/editing files, running commands, using the browser, and more", icon: "acp-4" },
  { name: "Codebuddy Code", ver: "manual", desc: "Tencent Cloud's official intelligent coding tool", icon: "acp-5" },
];
