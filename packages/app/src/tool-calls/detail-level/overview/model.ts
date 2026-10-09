import { isOsunaToolName } from "@osuna/protocol/tool-name-normalization";
import { describeToolCall, type ToolCallRun } from "../grouping";

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
// 0.14.x 的时间线里，按前缀直连的工具还带旧前缀，照样计入 Osuna 调用。
const DIRECT_OSUNA_TOOL_PREFIXES = ["osuna_", "paseo_"];
const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export interface OverviewSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  osunaCallCount: number;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

function isOsunaCall(name: string, normalizedName: string): boolean {
  const isDirectOsunaTool = DIRECT_OSUNA_TOOL_PREFIXES.some((prefix) =>
    normalizedName.startsWith(prefix),
  );
  return isOsunaToolName(name) || isDirectOsunaTool;
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

export function buildOverviewGroup(run: ToolCallRun): OverviewToolCallGroup {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let isLoading = false;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let osunaCallCount = 0;

  for (const call of run.calls) {
    const descriptor = describeToolCall(call);
    const normalizedName = descriptor.name.trim().toLowerCase();
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    if (isOsunaCall(descriptor.name, normalizedName)) {
      osunaCallCount += 1;
    } else if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") {
      editedFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "shell") {
      commandCount += 1;
    } else if (descriptor.detail.type === "read") {
      readFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "search" || isSearchCall(normalizedName)) {
      searchCount += 1;
    } else {
      otherToolCount += 1;
    }
  }

  const summary = {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    osunaCallCount,
  };
  return {
    mode: "overview",
    run,
    isLoading,
    summary,
  };
}
