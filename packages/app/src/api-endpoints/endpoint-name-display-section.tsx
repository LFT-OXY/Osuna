import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import {
  API_ENDPOINT_NAME_DISPLAYS,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { settingsStyles } from "@/styles/settings";
import {
  openEndpointNameDisplayForm,
  type EndpointNameDisplayFormState,
} from "./internal/endpoint-name-display-form";

/*
 * 「接口名显示方式」（照 magpie 设置页的 Provider in model names）：整台主机共用，管聊天模型选择器、默认模型选项、
 * Claude Code 与 Codex 的 /model 里模型后面带不带接口名。三选一，用下拉（docs/design.md），窄屏是底部弹层
 * （docs/menus.md），不盖住自己的标题。一选就存，存失败时回到存着的那项，原因写在这一行。
 * 「第三方接口」页底部一处；接口详情页另有一处（magpie 在 Names & levels 上面也放了它），多一行预览。
 * 管不到的 Agent 在行里写明（magpie noNamesSaid）。
 */

const KEY = "settings.apiEndpoints.endpointNames";

export function ApiEndpointNameDisplaySection({
  value,
  onSave,
  unreachedAgents,
  preview,
  testID,
}: {
  // 主机上存着的值；列表刷新带来新值时跟着变。
  value: ApiEndpointNameDisplay;
  onSave: (display: ApiEndpointNameDisplay) => Promise<string | null>;
  // 管不到的 Agent 的名字。
  unreachedAgents: string[];
  // 接口详情页的预览：按现在的选法，这家第一个模型在选单里叫什么；没有为 null。
  preview: ((display: ApiEndpointNameDisplay) => string | null) | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const [form] = useState(() => openEndpointNameDisplayForm({ initial: value, save: onSave }));
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  useEffect(() => form.hostChanged(value), [form, value]);
  const selectedLabel = t(`${KEY}.choices.${state.display}`);
  const error =
    state.status.kind === "failed"
      ? t(`${KEY}.saveFailed`, { message: state.status.message })
      : undefined;
  const previewLabel = preview?.(state.display) ?? null;
  const hint = useMemo(
    () => <RowHint previewLabel={previewLabel} unreachedAgents={unreachedAgents} testID={testID} />,
    [previewLabel, testID, unreachedAgents],
  );
  return (
    <SettingsSection title={t(`${KEY}.title`)} info={t(`${KEY}.info`)} testID={testID}>
      <SettingsCard>
        <SettingsRow label={t(`${KEY}.label`)} hint={hint} error={error} testID={`${testID}-row`}>
          <DisplayMenu state={state} label={selectedLabel} onChoose={form.choose} testID={testID} />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function RowHint({
  previewLabel,
  unreachedAgents,
  testID,
}: {
  previewLabel: string | null;
  unreachedAgents: string[];
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={settingsStyles.rowHint}>{t(`${KEY}.hint`)}</Text>
      {previewLabel !== null ? (
        <Text style={settingsStyles.rowHint} testID={`${testID}-preview`}>
          {t(`${KEY}.preview`, { label: previewLabel })}
        </Text>
      ) : null}
      {unreachedAgents.length > 0 ? (
        <Text style={settingsStyles.rowHint} testID={`${testID}-unreached`}>
          {t(`${KEY}.unreached`, { agents: unreachedAgents.join(", ") })}
        </Text>
      ) : null}
    </>
  );
}

function DisplayMenu({
  state,
  label,
  onChoose,
  testID,
}: {
  state: EndpointNameDisplayFormState;
  label: string;
  onChoose: (display: ApiEndpointNameDisplay) => Promise<void>;
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownTrigger
        accessibilityRole="button"
        accessibilityLabel={t(`${KEY}.accessibilityLabel`, { value: label })}
        disabled={state.status.kind === "saving"}
        testID={`${testID}-trigger`}
      >
        {label}
      </DropdownTrigger>
      <DropdownMenuContent side="bottom" align="end" width={220} sheetTitle={t(`${KEY}.title`)}>
        {API_ENDPOINT_NAME_DISPLAYS.map((display) => (
          <ChoiceItem
            key={display}
            display={display}
            selected={display === state.display}
            onChoose={onChoose}
            testID={`${testID}-${display}`}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChoiceItem({
  display,
  selected,
  onChoose,
  testID,
}: {
  display: ApiEndpointNameDisplay;
  selected: boolean;
  onChoose: (display: ApiEndpointNameDisplay) => Promise<void>;
  testID: string;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => void onChoose(display), [display, onChoose]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} testID={testID}>
      {t(`${KEY}.choices.${display}`)}
    </DropdownMenuItem>
  );
}
