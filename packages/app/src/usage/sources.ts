import type { UsageCli, UsageSourceRef } from "@osuna/protocol/usage/types";

/**
 * Source names are product names, not copy: they stay identical in every UI
 * language, so they are constants here instead of i18n keys.
 */
const CLI_LABELS: Record<UsageCli, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  omp: "OMP",
};

/**
 * The four CLIs whose logs the scanner reads. A Paseo provider id outside this
 * set — OpenCode, Copilot, an ACP agent, a custom binary — never produces usage
 * rows, so an empty report for it means "nothing to read", not "not read yet".
 * Custom providers that wrap one of the four carry their own id and fall
 * outside too; their usage shows up once rows land.
 */
const USAGE_TRACKED_PROVIDERS = new Set<string>(["claude", "codex", "pi", "omp"]);

export function isUsageTrackedProvider(provider: string | null | undefined): boolean {
  return provider !== null && provider !== undefined && USAGE_TRACKED_PROVIDERS.has(provider);
}

/**
 * Pi and OMP route to a backend the user names themselves, lowercased by the
 * parsers. Known names get their vendor spelling; anything else keeps the
 * user's own name with a capital first letter.
 */
const BACKEND_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  azure: "Azure",
  bedrock: "Bedrock",
  deepseek: "DeepSeek",
  github: "GitHub Copilot",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  groq: "Groq",
  mistral: "Mistral",
  moonshot: "Moonshot",
  ollama: "Ollama",
  openrouter: "OpenRouter",
  vertex: "Vertex AI",
  xai: "xAI",
  zai: "Z.AI",
};

const CLI_COLORS: Record<UsageCli, string> = {
  claude: "#d97757",
  codex: "#3b82f6",
  pi: "hsl(150, 60%, 45%)",
  omp: "hsl(270, 60%, 45%)",
};

/**
 * A backend keeps its colour whichever CLI routed to it, so the same vendor
 * reads the same in a Pi card and in an OMP card.
 */
const BACKEND_COLORS: Record<string, string> = {
  anthropic: "hsl(150, 60%, 45%)",
  openai: "hsl(190, 60%, 45%)",
  google: "hsl(230, 60%, 45%)",
  xai: "hsl(270, 60%, 45%)",
  ollama: "hsl(310, 60%, 45%)",
  deepseek: "hsl(350, 60%, 45%)",
  openrouter: "hsl(30, 60%, 45%)",
  groq: "hsl(70, 60%, 45%)",
  mistral: "hsl(110, 60%, 45%)",
};

export function usageBackendLabel(backend: string): string {
  const known = BACKEND_LABELS[backend];
  if (known) return known;
  return backend.charAt(0).toUpperCase() + backend.slice(1);
}

export function usageSourceLabel(ref: UsageSourceRef): string {
  const cli = CLI_LABELS[ref.cli];
  return ref.backend ? `${cli} · ${usageBackendLabel(ref.backend)}` : cli;
}

/** Deterministic fallback hue so an unknown backend keeps one colour per session. */
function fallbackHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}

export function usageSourceColor(ref: UsageSourceRef): string {
  if (!ref.backend) return CLI_COLORS[ref.cli];
  const known = BACKEND_COLORS[ref.backend];
  if (known) return known;
  return `hsl(${fallbackHue(ref.backend)}, 60%, 45%)`;
}
