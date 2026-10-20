import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { listedDisabledEntry } from "@getpaseo/protocol/api-endpoint/disabled-models";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { isWeb } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";
import {
  disableChoices,
  disabledModelHits,
  openDisabledModelsList,
  type DisabledModelsStatus,
} from "./internal/disabled-models-list";

/*
 * 「第三方接口」页底部的「已禁用的模型」（照 magpie 设置页的 Disabled models）：标题旁的说明讲管什么、式子怎么写；
 * 第一行「禁用…」打开选单（锚在这一行，和卡片同宽），从开着的接口的模型里挑，或照写一个 glob 回车；
 * 已在名单里的写法在选单里置灰并写明是哪一条。下面每条一行，逐行列出现在命中的模型，「启用」把它拿掉。
 */

const KEY = "settings.apiEndpoints.disabledModels";
// 命中的模型最多逐行列这么多个，其余写「还有 N 个」（magpie 同样列 4 个）。
const HITS_SHOWN = 4;
// 说明里的示例式子；拆开译文把它单独放进不折行的一段。
const EXAMPLE = "*-preview";
const EXAMPLE_MARK = "\u0001";

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
  const [query, setQuery] = useState("");
  const anchorRef = useRef<View>(null);
  const hits = useMemo(
    () => disabledModelHits({ patterns: state.patterns, endpoints }),
    [endpoints, state.patterns],
  );
  const options = useMemo(
    () => disableChoices({ endpoints, patterns: state.patterns }),
    [endpoints, state.patterns],
  );
  // 照写的这一条已在名单里（只差大小写也算）：存着的那条，否则 null。
  const listedAs = listedDisabledEntry({ patterns: state.patterns, pattern: query });
  const isSaving = state.status.kind === "saving";
  const handleOpen = useCallback(() => setIsPicking(true), []);
  const handleOpenChange = useCallback((open: boolean) => {
    setIsPicking(open);
    if (!open) setQuery("");
    // 选单关上后焦点回到「禁用…」会留下一圈焦点框；Web 上把它放掉。
    if (!open && isWeb) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
    }
  }, []);
  const handlePick = useCallback((picked: string) => void list.disable(picked), [list]);
  const renderOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => {
      const isTypedDuplicate = listedAs !== null && option.id === query.trim();
      return (
        <ComboboxItem
          label={option.label}
          description={
            isTypedDuplicate ? t(`${KEY}.alreadyListed`, { pattern: listedAs }) : option.description
          }
          selected={selected}
          active={active}
          disabled={isTypedDuplicate}
          onPress={onPress}
          testID={isTypedDuplicate ? "api-endpoints-disabled-models-listed-option" : undefined}
        />
      );
    },
    [listedAs, query, t],
  );
  const info = useMemo(
    () => <ExampleSentence text={t(`${KEY}.info`, { example: EXAMPLE_MARK })} />,
    [t],
  );
  const addHint = useMemo(() => <AddHint status={state.status} />, [state.status]);
  const disableLabel = t(`${KEY}.disable`);
  return (
    <SettingsSection title={t(`${KEY}.title`)} info={info} testID="api-endpoints-disabled-models">
      <SettingsCard>
        <View ref={anchorRef} collapsable={false}>
          <SettingsRow
            label={t(`${KEY}.addLabel`)}
            hint={addHint}
            testID="api-endpoints-disabled-models-add-row"
          >
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
          </SettingsRow>
        </View>
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
        renderOption={renderOption}
        onSearchQueryChange={setQuery}
        searchPlaceholder={t(`${KEY}.searchPlaceholder`)}
        emptyText={t(`${KEY}.noModels`)}
        allowCustomValue
        customValuePrefix={t(`${KEY}.customValuePrefix`)}
        customValueDescription={t(`${KEY}.customValueDescription`)}
        title={t(`${KEY}.addLabel`)}
        open={isPicking}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopLockWidth
      />
    </SettingsSection>
  );
}

/** 说明里的示例式子单独一段、不在连字符处折行。 */
function ExampleSentence({ text }: { text: string }) {
  const [before, after] = text.split(EXAMPLE_MARK);
  return (
    <>
      {before}
      <Text style={styles.unbroken}>{EXAMPLE}</Text>
      {after}
    </>
  );
}

function AddHint({ status }: { status: DisabledModelsStatus }) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={settingsStyles.rowHint}>{t(`${KEY}.addHint`)}</Text>
      {status.kind === "failed" ? (
        <Text
          accessibilityRole="alert"
          style={settingsStyles.rowError}
          selectable
          testID="api-endpoints-disabled-models-error"
        >
          {t(`${KEY}.saveFailed`, { message: status.message })}
        </Text>
      ) : null}
    </>
  );
}

/** 一条：式子与命中的模型各占一行，长了在行尾省略，不在连字符处折行。 */
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
  const shown = hits.slice(0, HITS_SHOWN);
  const rest = hits.length - shown.length;
  return (
    <View style={settingsStyles.row} testID={`api-endpoints-disabled-model-${pattern}`}>
      <View style={styles.entry}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1} selectable>
          {pattern}
        </Text>
        {hits.length === 0 ? (
          <Text style={settingsStyles.rowHint}>{t(`${KEY}.matchesNone`)}</Text>
        ) : (
          <Text style={settingsStyles.rowHint}>{t(`${KEY}.matches`, { n: hits.length })}</Text>
        )}
        {shown.map((hit) => (
          <Text key={hit} style={styles.hit} numberOfLines={1} selectable>
            {hit}
          </Text>
        ))}
        {rest > 0 ? <Text style={styles.hit}>{t(`${KEY}.more`, { n: rest })}</Text> : null}
      </View>
      <Button
        variant="ghost"
        size="sm"
        onPress={handleEnable}
        disabled={isSaving}
        accessibilityLabel={t(`${KEY}.enableModel`, { model: pattern })}
      >
        {t(`${KEY}.enable`)}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  entry: { flex: 1, minWidth: 0 },
  hit: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  unbroken: {
    color: theme.colors.foreground,
    ...(isWeb ? { whiteSpace: "nowrap" } : null),
  },
}));
