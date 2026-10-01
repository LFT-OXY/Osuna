import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";

export interface ProviderGroups<T> {
  enabled: T[];
  disabled: T[];
}

// Providers 列表分"已启用""已停用"两组，只看 enabled，组内保持快照顺序。
// 启用了但没装、出错、检测中的都在"已启用"，各自显示状态；daemon 不探测已停用的，App 不知道它装没装。
export function groupProvidersByEnabled<T extends Pick<ProviderSnapshotEntry, "enabled">>(
  entries: readonly T[],
): ProviderGroups<T> {
  const groups: ProviderGroups<T> = { enabled: [], disabled: [] };
  for (const entry of entries) {
    (entry.enabled ? groups.enabled : groups.disabled).push(entry);
  }
  return groups;
}
