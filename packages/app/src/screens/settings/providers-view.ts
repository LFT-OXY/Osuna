export type ProvidersView =
  | { kind: "list" }
  | { kind: "detail"; provider: string }
  // 地址里的提供方不在已加载的列表里，回到列表。
  | { kind: "missing" };

export interface ProvidersViewInput {
  // 地址里的提供方。
  requested: string | null;
  // 列表还没到（未连接或加载中）时为 null，此时不判定地址。
  providerIds: readonly string[] | null;
}

export function resolveProvidersView(input: ProvidersViewInput): ProvidersView {
  if (input.requested === null || input.providerIds === null) return { kind: "list" };
  if (input.providerIds.includes(input.requested)) {
    return { kind: "detail", provider: input.requested };
  }
  return { kind: "missing" };
}
