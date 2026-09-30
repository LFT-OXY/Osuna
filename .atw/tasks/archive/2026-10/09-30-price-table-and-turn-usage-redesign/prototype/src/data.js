// ───────── 示例数据（research/ui-tokens-supplement.md §3.3、§6） ─────────
// 价格单位：每百万 token 美元；LiteLLM 行取自 snapshot.json，自定义价为虚构示例
const PRICE_MODELS_INITIAL = [
  { model: "glm-4.6", priceSource: null, price: null, cli: "Claude Code" },
  { model: "qwen3-coder-plus", priceSource: null, price: null, cli: "Claude Code" },
  { model: "orcarouter/Qwen3.8-27B-Instruct-MLX", priceSource: null, price: null, cli: "OMP · orcarouter" },
  { model: "kimi-k2-turbo-preview", priceSource: null, price: null, cli: "Pi · Moonshot" },
  { model: "deepseek-v3.2-exp", priceSource: "override", price: { input: 0.28, cachedInput: 0.028, cacheWrite: 0, output: 0.42 }, cli: "Claude Code" },
  { model: "claude-sonnet-4-5", priceSource: "table", price: { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 } },
  { model: "claude-opus-4-5", priceSource: "table", price: { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 } },
  { model: "gpt-5-codex", priceSource: "table", price: { input: 1.25, cachedInput: 0.125, cacheWrite: 0, output: 10 } },
  { model: "claude-haiku-4-5", priceSource: "table", price: { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 } },
  { model: "gpt-5", priceSource: "table", price: { input: 1.25, cachedInput: 0.125, cacheWrite: 0, output: 10 } },
  { model: "claude-opus-4-1", priceSource: "table", price: { input: 15, cachedInput: 1.5, cacheWrite: 18.75, output: 75 } },
  { model: "gemini-2.5-pro", priceSource: "table", price: { input: 1.25, cachedInput: 0.125, cacheWrite: 0, output: 10 } },
  { model: "gpt-5-mini", priceSource: "table", price: { input: 0.25, cachedInput: 0.025, cacheWrite: 0, output: 2 } },
  { model: "gemini-2.5-flash", priceSource: "table", price: { input: 0.3, cachedInput: 0.03, cacheWrite: 0, output: 2.5 } },
];

const PRICE_FIELDS = [
  { field: "input", label: "输入", short: "入" },
  { field: "cachedInput", label: "缓存读", short: "读" },
  { field: "cacheWrite", label: "缓存写", short: "写" },
  { field: "output", label: "输出", short: "出" },
];

// ───────── 每轮用量示例（ui-tokens-supplement.md §3.3） ─────────
const TURNS = {
  multi: {
    durationMs: 132000,
    rows: [
      { model: "claude-sonnet-4-5", input: 14312, cache: 188600, output: 4580, reasoning: 0, cost: 0.189606, priced: true },
      { model: "claude-haiku-4-5", input: 2100, cache: 12000, output: 640, reasoning: 0, cost: 0.0065, priced: true },
    ],
  },
  single: {
    durationMs: 47000,
    rows: [{ model: "gpt-5-codex", input: 8420, cache: 51200, output: 3120, reasoning: 1856, cost: 0.048125, priced: true }],
  },
  unpriced: {
    durationMs: 3900000,
    rows: [
      { model: "glm-4.6", input: 22840, cache: 310400, output: 6120, reasoning: 0, cost: 0, priced: false },
      { model: "claude-haiku-4-5", input: 3200, cache: 18000, output: 910, reasoning: 0, cost: 0.00953, priced: true },
    ],
  },
};
