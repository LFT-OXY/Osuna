import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  API_ENDPOINT_NAME_DISPLAYS,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import {
  endpointNamePreview,
  openEndpointNameDisplayForm,
  type EndpointNameDisplayFormState,
} from "./internal/endpoint-name-display-form";

/*
 * 「接口名显示方式」（照 magpie 设置页的 Provider in model names）：整台主机共用，管聊天模型选择器、默认模型选项、
 * Claude Code 与 Codex 的 /model 里模型后面带不带接口名。三选一，用下拉（docs/design.md），窄屏是底部弹层
 * （docs/menus.md），不盖住自己的标题。一选就存，存失败时回到存着的那项，原因写在这一行。
 * 「第三方接口」页底部一个区；接口详情页「模型」区顶上一行（magpie 放在 Names & levels 的名字上面），多一行预览。
 * 管不到的 Agent 在行里写明（magpie noNamesSaid）。窄屏一律把下拉放到说明下面，按宽度、不按文字长短。
 */

const KEY = "settings.apiEndpoints.endpointNames";

interface NameDisplayRowProps {
  label: string;
  // 主机上存着的值；列表刷新带来新值时跟着变。
  value: ApiEndpointNameDisplay;
  onSave: (display: ApiEndpointNameDisplay) => Promise<string | null>;
  // 管不到的 Agent 的名字。
  unreachedAgents: string[];
  // 接口详情页预览的那一家；不预览为 null。
  previewEndpoint: ApiEndpoint | null;
  // 预览按它们判断同名、去掉已禁用的模型。
  allEndpoints: readonly ApiEndpoint[];
  disabledModels: readonly string[];
  testID: string;
}

/** 「第三方接口」页底部的「接口名显示方式」区。 */
export function ApiEndpointNameDisplaySection(props: Omit<NameDisplayRowProps, "label">) {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t(`${KEY}.title`)} info={t(`${KEY}.info`)} testID={props.testID}>
      <View style={settingsStyles.card}>
        <ApiEndpointNameDisplayRow {...props} label={t(`${KEY}.label`)} />
      </View>
    </SettingsSection>
  );
}

/** 一行：名字、说明（预览、管不到的 Agent）、三选一的下拉；放进哪张卡由调用方定。 */
export function ApiEndpointNameDisplayRow({
  label,
  value,
  onSave,
  unreachedAgents,
  previewEndpoint,
  allEndpoints,
  disabledModels,
  testID,
}: NameDisplayRowProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [form] = useState(() => openEndpointNameDisplayForm({ initial: value, save: onSave }));
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  useEffect(() => form.hostChanged(value), [form, value]);
  const selectedLabel = t(`${KEY}.choices.${state.display}`);
  const previewLabel =
    previewEndpoint === null
      ? null
      : endpointNamePreview({
          endpoint: previewEndpoint,
          endpoints: allEndpoints,
          disabledModels,
          display: state.display,
        });
  return (
    <View style={[settingsStyles.row, isCompact && styles.rowStacked]} testID={`${testID}-row`}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
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
        {state.status.kind === "failed" ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {t(`${KEY}.saveFailed`, { message: state.status.message })}
          </Text>
        ) : null}
      </View>
      <DisplayMenu state={state} label={selectedLabel} onChoose={form.choose} testID={testID} />
    </View>
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

const styles = StyleSheet.create((theme) => ({
  rowStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
}));
