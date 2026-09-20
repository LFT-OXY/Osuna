export type ProviderCommandId = "resume";

/**
 * Declarative command templates for provider-native CLIs.
 *
 * Note: these are NOT Paseo agent IDs. They take provider-native session IDs.
 * Example placeholders:
 * - {sessionId}
 */
export const PROVIDER_COMMAND_TEMPLATES: Record<
  string,
  Partial<Record<ProviderCommandId, string>>
> = {
  codex: {
    resume: "codex resume {sessionId}",
  },
  claude: {
    resume: "claude --resume {sessionId}",
  },
  hermes: {
    resume: "hermes --resume {sessionId}",
  },
  pi: {
    resume: "pi --session {sessionId}",
  },
  omp: {
    resume: "omp --session {sessionId}",
  },
  opencode: {
    resume: "opencode --session {sessionId}",
  },
  copilot: {
    resume: "copilot --resume={sessionId}",
  },
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");
}

export function hasProviderCommand(provider: string, id: ProviderCommandId): boolean {
  return Boolean(PROVIDER_COMMAND_TEMPLATES[provider]?.[id]);
}

export function buildProviderCommand(input: {
  provider: string;
  id: ProviderCommandId;
  sessionId: string;
}): string | null {
  const argv = buildProviderCommandArgv(input);
  return argv ? [argv.command, ...argv.args].join(" ") : null;
}

export interface ProviderCommandArgv {
  command: string;
  args: string[];
}

// 终端创建走 command + args 直接起进程，不经 shell；模板先按空白切 token，
// 再逐 token 代入，会话 id 里的空格不会被切开。
export function buildProviderCommandArgv(input: {
  provider: string;
  id: ProviderCommandId;
  sessionId: string;
}): ProviderCommandArgv | null {
  const template = PROVIDER_COMMAND_TEMPLATES[input.provider]?.[input.id] ?? null;
  if (!template) {
    return null;
  }
  const tokens = template
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => renderTemplate(token, { sessionId: input.sessionId }));
  const [command, ...args] = tokens;
  if (!command) {
    return null;
  }
  return { command, args };
}
