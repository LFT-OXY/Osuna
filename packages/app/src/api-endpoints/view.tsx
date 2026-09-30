import React, { useCallback, useState } from "react";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { ApiEndpointFormSheet } from "./form-sheet";
import { ApiEndpointsSection } from "./index";
import type { ApiEndpointFormSeed } from "./internal/form-model";
import { useApiEndpoints } from "./use-api-endpoints";

/*
 * 运行时接线：客户端、查询、确认框、toast。surface（index.tsx）保持纯 props，方便 jsdom 测试。
 * 调用方负责能力门控：只在主机声明了 apiEndpoints、provider 受支持时渲染。
 */

export function ApiEndpointsView({
  serverId,
  provider,
  providerLabel,
}: {
  serverId: string;
  provider: string;
  providerLabel: string;
}) {
  const { state, busy, actionError, dismissActionError, activate, remove, save, fetchModels } =
    useApiEndpoints({
      serverId,
      provider,
      providerLabel,
    });
  const [form, setForm] = useState<ApiEndpointFormSeed | null>(null);

  const handleAdd = useCallback(() => setForm({ mode: "create", provider }), [provider]);
  const handleEdit = useCallback(
    (endpoint: ApiEndpoint) => setForm({ mode: "edit", provider, endpoint }),
    [provider],
  );
  const handleCloseForm = useCallback(() => setForm(null), []);

  return (
    <>
      <ApiEndpointsSection
        providerLabel={providerLabel}
        state={state}
        busy={busy}
        actionError={actionError}
        onDismissError={dismissActionError}
        onActivate={activate}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={remove}
      />
      {form ? (
        <ApiEndpointFormSheet
          key={form.mode === "edit" ? `edit-${form.endpoint.id}` : "create"}
          seed={form}
          onSave={save}
          onFetchModels={fetchModels}
          onClose={handleCloseForm}
        />
      ) : null}
    </>
  );
}
