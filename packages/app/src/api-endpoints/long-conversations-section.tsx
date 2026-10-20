import React, { useCallback, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import type { ApiEndpointLongConversations } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import {
  openLongConversationsForm,
  type LongConversationsChange,
} from "./internal/long-conversations-form";
import { tokenFormatOf } from "./internal/model-settings-form";

/*
 * 「第三方接口」页底部的「长对话」（照 magpie 设置页的 Long conversations）：整台主机共用，告诉 Codex、Claude Code
 * 在哪压缩。「完整窗口」开着时压缩阈值的输入框收起（magpie 同样）；输入框回车或离开时存。
 */

const KEY = "settings.apiEndpoints.longConversations";
// FormTextInput 会压平 style 拆成外框与文字，Unistyles 样式在 Web 上压平后没有值，所以用普通对象。
const WIDE_INPUT_STYLE = { width: 180 };
const COMPACT_INPUT_STYLE = { width: 140 };

export function ApiEndpointLongConversationsSection({
  initial,
  onSave,
}: {
  initial: ApiEndpointLongConversations;
  onSave: (change: LongConversationsChange) => Promise<string | null>;
}) {
  const { t, i18n } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [form] = useState(() =>
    openLongConversationsForm({ initial, save: onSave, tokenFormat: tokenFormatOf(i18n.language) }),
  );
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const handleSwitch = useCallback((on: boolean) => void form.setFullContext(on), [form]);
  const handleCommit = useCallback(() => void form.commitCompact(), [form]);
  const fullWindow = t(`${KEY}.fullWindow`);
  const compactAt = t("settings.apiEndpoints.modelSettings.compact");
  const isSaving = state.status.kind === "saving";
  const hint = (
    <>
      <Text style={settingsStyles.rowHint}>{t(`${KEY}.hint`, { size: state.placeholder })}</Text>
      {state.status.kind === "failed" ? (
        <Text
          accessibilityRole="alert"
          style={settingsStyles.rowError}
          selectable
          testID="api-endpoints-long-conversations-error"
        >
          {t(`${KEY}.saveFailed`, { message: state.status.message })}
        </Text>
      ) : null}
    </>
  );
  return (
    <SettingsSection title={t(`${KEY}.title`)} testID="api-endpoints-long-conversations">
      <SettingsCard>
        <SettingsRow label={fullWindow} hint={hint}>
          <Switch
            value={state.fullContext}
            onValueChange={handleSwitch}
            disabled={isSaving}
            accessibilityLabel={fullWindow}
            testID="api-endpoints-full-window-switch"
          />
        </SettingsRow>
        {state.fullContext ? null : (
          <SettingsRow
            label={compactAt}
            error={
              state.compactAt.invalid
                ? t("settings.apiEndpoints.modelSettings.invalidTokens")
                : undefined
            }
            testID="api-endpoints-compact-at-row"
          >
            <FormTextInput
              initialValue={state.compactAt.text}
              onChangeText={form.setCompactText}
              onBlur={handleCommit}
              onSubmitEditing={handleCommit}
              placeholder={state.placeholder}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel={compactAt}
              invalid={state.compactAt.invalid}
              editable={!isSaving}
              size={isCompact ? "md" : "sm"}
              style={isCompact ? COMPACT_INPUT_STYLE : WIDE_INPUT_STYLE}
              testID="api-endpoints-compact-at"
            />
          </SettingsRow>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
