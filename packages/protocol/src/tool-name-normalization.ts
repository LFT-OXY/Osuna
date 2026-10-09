// OpenCode、Pi、OMP 的原生写法各不相同，adapter 统一改成这个名字，app 不认 provider 各自的拼法。
export const OSUNA_CREATE_AGENT_TOOL_NAME = "osuna.create_agent";

const TOOL_TOKEN_REGEX = /[a-z0-9]+/g;
const STANDARD_NAMESPACE_SEPARATOR_REGEX = /[.:/]/;

export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function tokenizeToolName(name: string): string[] {
  const normalized = normalizeToolName(name);
  return normalized.match(TOOL_TOKEN_REGEX) ?? [];
}

export function getToolLeafName(name: string): string | null {
  const tokens = tokenizeToolName(name);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

export function isSpeakToolName(name: string): boolean {
  return getToolLeafName(name) === "speak";
}

export function isLikelyNamespacedToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  if (STANDARD_NAMESPACE_SEPARATOR_REGEX.test(normalized)) {
    return true;
  }
  if (!normalized.includes("__")) {
    return false;
  }

  // Keep `__` handling strict to avoid false positives on arbitrary custom names.
  const segments = normalized.split("__").filter((segment) => segment.length > 0);
  if (segments.length >= 3) {
    return true;
  }
  if (segments.length === 2 && segments[1].includes("_")) {
    return true;
  }
  return false;
}

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
// 0.14.x 的 MCP server 叫旧名字，升级前的时间线里记的是那个名字下的工具。
// 认名字空间时两个都算，旧历史里的工具调用才会照样显示成 Osuna 工具。
const TOOL_NAMESPACES = ["osuna", "paseo"];

function isOsunaToolNamespace(segment: string): boolean {
  return TOOL_NAMESPACES.some(
    (namespace) => segment === namespace || segment.startsWith(`${namespace}_`),
  );
}

export function isOsunaToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  if (isSpeakToolName(normalized)) {
    return false;
  }
  if (normalized.includes("__")) {
    const segments = normalized.split("__").filter((s) => s.length > 0);
    return segments.length >= 3 && segments[0] === "mcp" && isOsunaToolNamespace(segments[1]);
  }
  if (normalized.includes(".")) {
    return isOsunaToolNamespace(normalized.split(".")[0]);
  }
  return false;
}

export function getOsunaToolLeafName(name: string): string | null {
  const normalized = normalizeToolName(name);
  if (normalized.includes("__")) {
    const segments = normalized.split("__").filter((s) => s.length > 0);
    if (segments.length >= 3 && segments[0] === "mcp" && isOsunaToolNamespace(segments[1])) {
      return segments.slice(2).join("__");
    }
    return null;
  }
  if (normalized.includes(".")) {
    if (isOsunaToolNamespace(normalized.split(".")[0])) {
      return normalized.split(".").slice(1).join(".");
    }
    return null;
  }
  return null;
}

export function isLikelyExternalToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return false;
  }
  if (isSpeakToolName(normalized)) {
    return true;
  }
  return isLikelyNamespacedToolName(normalized);
}
