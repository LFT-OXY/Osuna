import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";

export type NotEnabledMark = "turnedOff" | "notInstalled";

export type ProviderPlacement = { kind: "list" } | { kind: "notEnabled"; mark: NotEnabledMark };

// Providers 列表只放在用的提供方，其余进「添加提供方」的"未启用"组；列表与弹窗共用这条规则。
// daemon 不探测已停用的提供方，它们的状态也是 unavailable，所以先看 enabled。
export function resolveProviderPlacement(
  entry: Pick<ProviderSnapshotEntry, "status" | "enabled">,
): ProviderPlacement {
  if (!entry.enabled) return { kind: "notEnabled", mark: "turnedOff" };
  if (entry.status === "unavailable") return { kind: "notEnabled", mark: "notInstalled" };
  return { kind: "list" };
}
