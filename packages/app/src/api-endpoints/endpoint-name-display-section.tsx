import React, { useCallback, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  API_ENDPOINT_NAME_DISPLAYS,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { openEndpointNameDisplayForm } from "./internal/endpoint-name-display-form";

/*
 * 「第三方接口」页底部的「接口名显示方式」（照 magpie 设置页的 Provider in model names）：整台主机共用，
 * 管聊天模型选择器、默认模型选项和写给 Codex 的显示名里模型后面带不带接口名。三选一，用下拉（docs/design.md）；
 * 一选就存，存失败时回到存着的那项，原因写在这一行。
 */

const KEY = "settings.apiEndpoints.endpointNames";

export function ApiEndpointNameDisplaySection({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (display: ApiEndpointNameDisplay) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [form] = useState(() => openEndpointNameDisplayForm({ initial, save: onSave }));
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const selectedLabel = t(`${KEY}.choices.${state.display}`);
  const error =
    state.status.kind === "failed"
      ? t(`${KEY}.saveFailed`, { message: state.status.message })
      : undefined;
  return (
    <SettingsSection
      title={t(`${KEY}.title`)}
      info={t(`${KEY}.info`)}
      testID="api-endpoints-endpoint-names"
    >
      <SettingsCard>
        <SettingsRow
          label={t(`${KEY}.label`)}
          hint={t(`${KEY}.hint`)}
          error={error}
          testID="api-endpoints-endpoint-names-row"
        >
          <DropdownMenu>
            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={t(`${KEY}.accessibilityLabel`, { value: selectedLabel })}
              disabled={state.status.kind === "saving"}
              testID="api-endpoints-endpoint-names-trigger"
            >
              {selectedLabel}
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={200}>
              {API_ENDPOINT_NAME_DISPLAYS.map((display) => (
                <ChoiceItem
                  key={display}
                  display={display}
                  selected={display === state.display}
                  onChoose={form.choose}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function ChoiceItem({
  display,
  selected,
  onChoose,
}: {
  display: ApiEndpointNameDisplay;
  selected: boolean;
  onChoose: (display: ApiEndpointNameDisplay) => Promise<void>;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => void onChoose(display), [display, onChoose]);
  return (
    <DropdownMenuItem
      selected={selected}
      onSelect={handleSelect}
      testID={`api-endpoints-endpoint-names-${display}`}
    >
      {t(`${KEY}.choices.${display}`)}
    </DropdownMenuItem>
  );
}
