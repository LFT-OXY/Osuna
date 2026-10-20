import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { settingsStyles } from "@/styles/settings";
import {
  disableChoices,
  disabledModelHits,
  openDisabledModelsList,
  type DisabledModelsStatus,
} from "./internal/disabled-models-list";

/*
 * 「第三方接口」页底部的「已禁用的模型」（照 magpie 设置页的 Disabled models）：第一行说清管什么、「禁用…」打开选单，
 * 从开着的接口的模型里挑，或照写一个 glob 回车；下面每条一行，写着现在命中哪些模型，「启用」把它拿掉。
 */

const KEY = "settings.apiEndpoints.disabledModels";
// 命中的模型最多列这么多个，其余写省略号（magpie 同样 4 个）。
const HITS_SHOWN = 4;

export function ApiEndpointDisabledModelsSection({
  initial,
  endpoints,
  onSave,
}: {
  initial: string[];
  endpoints: ApiEndpoint[];
  onSave: (models: string[]) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [list] = useState(() => openDisabledModelsList({ initial, save: onSave }));
  const state = useSyncExternalStore(list.subscribe, list.getState, list.getState);
  const [isPicking, setIsPicking] = useState(false);
  const anchorRef = useRef<View>(null);
  const hits = useMemo(
    () => disabledModelHits({ patterns: state.patterns, endpoints }),
    [endpoints, state.patterns],
  );
  const options = useMemo(
    () => disableChoices({ endpoints, patterns: state.patterns }),
    [endpoints, state.patterns],
  );
  const isSaving = state.status.kind === "saving";
  const handleOpen = useCallback(() => setIsPicking(true), []);
  const handlePick = useCallback((picked: string) => void list.disable(picked), [list]);
  const disableLabel = t(`${KEY}.disable`);
  const addHint = useMemo(() => <AddHint status={state.status} />, [state.status]);
  return (
    <SettingsSection title={t(`${KEY}.title`)} testID="api-endpoints-disabled-models">
      <SettingsCard>
        <SettingsRow
          label={t(`${KEY}.addLabel`)}
          hint={addHint}
          testID="api-endpoints-disabled-models-add-row"
        >
          <View ref={anchorRef} collapsable={false}>
            <Button
              variant="outline"
              size="sm"
              onPress={handleOpen}
              disabled={isSaving}
              accessibilityLabel={disableLabel}
              testID="api-endpoints-disabled-models-add"
            >
              {disableLabel}
            </Button>
          </View>
        </SettingsRow>
        {state.patterns.map((pattern) => (
          <DisabledModelRow
            key={pattern}
            pattern={pattern}
            hits={hits[pattern] ?? []}
            isSaving={isSaving}
            onEnable={list.enable}
          />
        ))}
      </SettingsCard>
      <Combobox
        options={options}
        value=""
        onSelect={handlePick}
        searchPlaceholder={t(`${KEY}.searchPlaceholder`)}
        emptyText={t(`${KEY}.noModels`)}
        allowCustomValue
        customValuePrefix={t(`${KEY}.customValuePrefix`)}
        customValueDescription={t(`${KEY}.customValueDescription`)}
        title={t(`${KEY}.addLabel`)}
        open={isPicking}
        onOpenChange={setIsPicking}
        anchorRef={anchorRef}
      />
    </SettingsSection>
  );
}

function AddHint({ status }: { status: DisabledModelsStatus }) {
  const { t } = useTranslation();
  let problem: string | null = null;
  if (status.kind === "duplicate") problem = t(`${KEY}.duplicate`, { pattern: status.pattern });
  if (status.kind === "failed") problem = t(`${KEY}.saveFailed`, { message: status.message });
  return (
    <>
      <Text style={settingsStyles.rowHint}>{t(`${KEY}.addHint`)}</Text>
      {problem !== null ? (
        <Text
          accessibilityRole="alert"
          style={settingsStyles.rowError}
          selectable
          testID="api-endpoints-disabled-models-error"
        >
          {problem}
        </Text>
      ) : null}
    </>
  );
}

function DisabledModelRow({
  pattern,
  hits,
  isSaving,
  onEnable,
}: {
  pattern: string;
  hits: string[];
  isSaving: boolean;
  onEnable: (pattern: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const handleEnable = useCallback(() => void onEnable(pattern), [onEnable, pattern]);
  let hint = t(`${KEY}.matchesNone`);
  if (hits.length > 0) {
    const shown = hits.slice(0, HITS_SHOWN).join(", ");
    const list = hits.length > HITS_SHOWN ? `${shown}, …` : shown;
    hint = t(`${KEY}.matches`, { n: hits.length, list });
  }
  return (
    <SettingsRow label={pattern} hint={hint} testID={`api-endpoints-disabled-model-${pattern}`}>
      <Button
        variant="ghost"
        size="sm"
        onPress={handleEnable}
        disabled={isSaving}
        accessibilityLabel={t(`${KEY}.enableModel`, { model: pattern })}
      >
        {t(`${KEY}.enable`)}
      </Button>
    </SettingsRow>
  );
}
