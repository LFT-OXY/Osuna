// 余额查询地址、方法、取值写法与「查询余额」的编排照 magpie（https://github.com/yetone/magpie，
// internal/gui/assets/app.js 编辑窗口的 Balance URL、Balance request method、Balance field、Check balance、
// 账户令牌（Account balance）、balanceFix、团队的 zhipuTeam 两栏与火山、腾讯的 AccessKey 两栏，7597c132）。「自动识别」是 Osuna 加的，magpie 没有。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import React, { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  balanceUrlPath,
  NEW_API_BALANCE_QUERIES,
  type ApiEndpointBalanceMethod,
} from "@getpaseo/protocol/api-endpoint/balance-settings";
import type {
  ApiEndpointBalanceReading,
  ApiEndpointBalanceUrlAttempt,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { AdvancedFieldLabel } from "./advanced-field-label";
import { failureTitle, hintOf, itemLabel } from "./balance-copy";
import type {
  ConnectionAccessKeyPart,
  ConnectionFormModel,
  ConnectionFormState,
  SecretBoxState,
} from "./internal/connection-form-model";

const KEY = "settings.apiEndpoints.form.balance";

/**
 * 「高级」里的余额设置：方法（GET / POST）与余额查询地址同一行，取值写法的占位是按地址给的默认写法；
 * 地址下面的「自动识别」用表单里的 key 与地址试 new-api、sub2api 的余额地址，试中就填上，结果写在按钮旁。
 * 账户令牌打码（可显示、可移除），令牌与地址对不上时就地提示并给「改用 …」；new-api 的用户 ID；
 * 地址是智谱或 Z.ai 时另有团队组织 ID 与项目 ID；是火山方舟或腾讯云 Token Plan 企业版时另有云账号密钥两栏（打码、可显示，
 * 一起移除）。
 * 「查询余额」在最后，用表单里还没保存的值当场查，结果写在按钮旁，留到再查或关掉窗口。说明都在信息提示里。
 */
export function BalanceSettingsFields({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const urlLabel = t(`${KEY}.url`);
  const fieldLabel = t(`${KEY}.field`);
  const userIdLabel = t(`${KEY}.userId`);
  const methods = useMemo<SegmentedControlOption<ApiEndpointBalanceMethod>[]>(
    () => [
      { value: "GET", label: "GET", testID: "api-endpoint-connection-balance-get" },
      { value: "POST", label: "POST", testID: "api-endpoint-connection-balance-post" },
    ],
    [],
  );
  const check = state.balanceCheck;
  const isChecking = check.status === "checking";
  return (
    <>
      <View style={styles.field} testID="api-endpoint-connection-balance-url">
        <AdvancedFieldLabel
          label={urlLabel}
          info={t(`${KEY}.urlInfo`)}
          testID="api-endpoint-connection-balance-url-info"
        />
        <View style={styles.urlRow}>
          <SegmentedControl
            options={methods}
            value={state.balanceMethod}
            onValueChange={model.setBalanceMethod}
            size="sm"
            style={styles.segmentTrack}
            testID="api-endpoint-connection-balance-method"
          />
          <View style={styles.flex}>
            <FormTextInput
              initialValue={state.balanceUrlText}
              resetKey={state.balanceUrlGeneration}
              onChangeText={model.setBalanceUrl}
              placeholder="https://…/api/usage/token"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={state.focusesBalance}
              keyboardType="url"
              size={size}
              accessibilityLabel={urlLabel}
              testID="api-endpoint-connection-balance-url-input"
            />
          </View>
        </View>
        <View style={styles.checkRow}>
          <Button
            variant="outline"
            size="sm"
            onPress={model.detectBalanceUrl}
            loading={state.balanceDetect.status === "detecting"}
            disabled={!state.canDetectBalanceUrl}
            testID="api-endpoint-connection-detect-balance-url"
          >
            {t(`${KEY}.detect`)}
          </Button>
          <DetectResult detect={state.balanceDetect} />
        </View>
      </View>
      <View style={styles.field} testID="api-endpoint-connection-balance-field">
        <AdvancedFieldLabel
          label={fieldLabel}
          info={t(`${KEY}.fieldInfo`)}
          testID="api-endpoint-connection-balance-field-info"
        />
        <FormTextInput
          initialValue={state.balanceFieldText}
          resetKey={state.balanceFieldGeneration}
          onChangeText={model.setBalanceField}
          placeholder={state.balanceFieldPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          size={size}
          accessibilityLabel={fieldLabel}
          testID="api-endpoint-connection-balance-field-input"
        />
      </View>
      <BalanceTokenField state={state} model={model} size={size} />
      <View style={styles.field} testID="api-endpoint-connection-balance-user-id">
        <AdvancedFieldLabel
          label={userIdLabel}
          info={t(`${KEY}.userIdInfo`)}
          testID="api-endpoint-connection-balance-user-id-info"
        />
        <FormTextInput
          initialValue={state.balanceUserIdText}
          onChangeText={model.setBalanceUserId}
          placeholder={t(`${KEY}.userIdPlaceholder`)}
          autoCapitalize="none"
          autoCorrect={false}
          size={size}
          accessibilityLabel={userIdLabel}
          testID="api-endpoint-connection-balance-user-id-input"
        />
      </View>
      {state.isZhipuAddress ? (
        <>
          <TeamIdField
            label={t(`${KEY}.teamOrgId`)}
            info={t(`${KEY}.teamOrgIdInfo`)}
            placeholder={t(`${KEY}.teamOrgIdPlaceholder`)}
            value={state.balanceTeamOrgIdText}
            onChangeText={model.setBalanceTeamOrgId}
            invalid={state.hasLoneTeamId && state.balanceTeamOrgIdText.trim() === ""}
            size={size}
            testID="api-endpoint-connection-balance-team-org"
          />
          <TeamIdField
            label={t(`${KEY}.teamProjectId`)}
            info={t(`${KEY}.teamProjectIdInfo`)}
            placeholder={t(`${KEY}.teamProjectIdPlaceholder`)}
            value={state.balanceTeamProjectIdText}
            onChangeText={model.setBalanceTeamProjectId}
            invalid={state.hasLoneTeamId && state.balanceTeamProjectIdText.trim() === ""}
            size={size}
            testID="api-endpoint-connection-balance-team-project"
          />
          {state.hasLoneTeamId ? (
            <Text
              variant="caption"
              color="statusWarning"
              accessibilityLiveRegion="polite"
              testID="api-endpoint-connection-balance-team-both"
            >
              {t(`${KEY}.teamBothNeeded`)}
            </Text>
          ) : null}
        </>
      ) : null}
      {state.accessKeyVendor ? (
        <AccessKeyFields vendor={state.accessKeyVendor} state={state} model={model} size={size} />
      ) : null}
      <View style={styles.checkRow}>
        <Button
          variant="outline"
          size="sm"
          onPress={model.checkBalance}
          loading={isChecking}
          disabled={isChecking}
          testID="api-endpoint-connection-check-balance"
        >
          {t(`${KEY}.check`)}
        </Button>
        <CheckResult check={check} />
      </View>
    </>
  );
}

/** 智谱团队组织 ID、项目 ID 的一栏（照 magpie 编辑器的 Team organization / Team project）。 */
function TeamIdField({
  label,
  info,
  placeholder,
  value,
  onChangeText,
  invalid,
  size,
  testID,
}: {
  label: string;
  info: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  // 另一栏填了、这栏空着：描成警告的边，看得出缺的是哪一栏。
  invalid: boolean;
  size: "sm" | "md";
  testID: string;
}) {
  return (
    <View style={styles.field} testID={testID}>
      <AdvancedFieldLabel label={label} info={info} testID={`${testID}-info`} />
      <FormTextInput
        initialValue={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        invalid={invalid}
        size={size}
        accessibilityLabel={label}
        testID={`${testID}-input`}
      />
    </View>
  );
}

const ACCESS_KEY_LABELS = {
  volcengine: { id: `${KEY}.volcAccessKeyId`, secret: `${KEY}.volcSecretAccessKey` },
  tencent: { id: `${KEY}.tencentSecretId`, secret: `${KEY}.tencentSecretKey` },
} as const;

/**
 * 云账号密钥两栏（照 magpie 编辑器的 AccessKey ID 与 Secret）：火山写 AccessKey ID 与 Secret Access Key，腾讯写 SecretId
 * 与 SecretKey。存了的「移除」两样一起去掉；有 ID 没 Secret 时提示补上 Secret。
 */
function AccessKeyFields({
  vendor,
  state,
  model,
  size,
}: {
  vendor: NonNullable<ConnectionFormState["accessKeyVendor"]>;
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const labels = ACCESS_KEY_LABELS[vendor];
  return (
    <>
      <SecretKeyField
        part="id"
        label={t(labels.id)}
        info={t(`${KEY}.accessKeyInfo`, { vendor: t(`${KEY}.accessKeyVendor.${vendor}`) })}
        box={state.accessKeyId}
        invalid={false}
        autoFocus={state.focusesAccessKey}
        model={model}
        size={size}
        testID="api-endpoint-connection-access-key-id"
      />
      <SecretKeyField
        part="secret"
        label={t(labels.secret)}
        info={t(`${KEY}.secretAccessKeyInfo`)}
        box={state.secretAccessKey}
        invalid={state.hasLoneAccessKey}
        autoFocus={false}
        onRemove={state.hasSavedAccessKey ? model.removeAccessKey : null}
        model={model}
        size={size}
        testID="api-endpoint-connection-secret-access-key"
      />
      {state.hasLoneAccessKey ? (
        <Text
          variant="caption"
          color="statusWarning"
          accessibilityLiveRegion="polite"
          testID="api-endpoint-connection-access-key-both"
        >
          {t(`${KEY}.accessKeySecretNeeded`, { secret: t(labels.secret) })}
        </Text>
      ) : null}
    </>
  );
}

/** 云账号密钥的一栏：打码框，「显示」读回原文；Secret 一栏存了的可「移除」（两样一起）。 */
function SecretKeyField({
  part,
  label,
  info,
  box,
  invalid,
  autoFocus,
  onRemove = null,
  model,
  size,
  testID,
}: {
  part: ConnectionAccessKeyPart;
  label: string;
  info: string;
  box: SecretBoxState;
  invalid: boolean;
  autoFocus: boolean;
  onRemove?: (() => void) | null;
  model: ConnectionFormModel;
  size: "sm" | "md";
  testID: string;
}) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (value: string) => model.setAccessKey(part, value),
    [model, part],
  );
  const handleToggle = useCallback(() => model.toggleAccessKeyVisible(part), [model, part]);
  const placeholder = box.mask ? t(`${KEY}.tokenSavedPlaceholder`, { mask: box.mask }) : label;
  return (
    <View style={styles.field} testID={testID}>
      <AdvancedFieldLabel label={label} info={info} testID={`${testID}-info`} />
      <View style={styles.tokenRow}>
        <View style={styles.tokenBox}>
          <FormTextInput
            key={box.isVisible ? "shown" : "hidden"}
            initialValue={box.boxValue}
            resetKey={box.boxGeneration}
            onChangeText={handleChange}
            placeholder={placeholder}
            secureTextEntry={!box.isVisible}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={autoFocus}
            invalid={invalid || box.revealError !== null}
            size={size}
            accessibilityLabel={label}
            testID={`${testID}-input`}
          />
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={handleToggle}
          loading={box.isRevealing}
          testID={`${testID}-show`}
        >
          {box.isVisible
            ? t("settings.apiEndpoints.form.hideKey")
            : t("settings.apiEndpoints.form.showKey")}
        </Button>
        {onRemove ? (
          <Button
            variant="outline"
            size="sm"
            onPress={onRemove}
            testID="api-endpoint-connection-access-key-remove"
          >
            {t(`${KEY}.accessKeyRemove`)}
          </Button>
        ) : null}
      </View>
      {box.revealError ? (
        <Text variant="caption" color="statusDanger" selectable>
          {box.revealError}
        </Text>
      ) : null}
    </View>
  );
}

/** 账户令牌：打码框，「显示」读回原文，存了的可「移除」；下面是令牌与地址对不上时的提示。 */
function BalanceTokenField({
  state,
  model,
  size,
}: {
  state: ConnectionFormState;
  model: ConnectionFormModel;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const label = t(`${KEY}.token`);
  const placeholder = state.balanceTokenMask
    ? t(`${KEY}.tokenSavedPlaceholder`, { mask: state.balanceTokenMask })
    : t(`${KEY}.tokenPlaceholder`);
  return (
    <View style={styles.field} testID="api-endpoint-connection-balance-token">
      <AdvancedFieldLabel
        label={label}
        info={t(`${KEY}.tokenInfo`)}
        testID="api-endpoint-connection-balance-token-info"
      />
      <View style={styles.tokenRow}>
        <View style={styles.tokenBox}>
          <FormTextInput
            key={state.isBalanceTokenVisible ? "shown" : "hidden"}
            initialValue={state.balanceTokenBoxValue}
            resetKey={state.balanceTokenBoxGeneration}
            onChangeText={model.setBalanceToken}
            placeholder={placeholder}
            secureTextEntry={!state.isBalanceTokenVisible}
            autoCapitalize="none"
            autoCorrect={false}
            invalid={state.balanceTokenRevealError !== null}
            size={size}
            accessibilityLabel={label}
            testID="api-endpoint-connection-balance-token-input"
          />
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={model.toggleBalanceTokenVisible}
          loading={state.isRevealingBalanceToken}
          testID="api-endpoint-connection-balance-token-show"
        >
          {state.isBalanceTokenVisible
            ? t("settings.apiEndpoints.form.hideKey")
            : t("settings.apiEndpoints.form.showKey")}
        </Button>
        {state.hasSavedBalanceToken ? (
          <Button
            variant="outline"
            size="sm"
            onPress={model.removeBalanceToken}
            testID="api-endpoint-connection-balance-token-remove"
          >
            {t(`${KEY}.tokenRemove`)}
          </Button>
        ) : null}
      </View>
      {state.balanceTokenRevealError ? (
        <Text variant="caption" color="statusDanger" selectable>
          {state.balanceTokenRevealError}
        </Text>
      ) : null}
      {state.balanceFix ? <BalanceFixNotice fix={state.balanceFix} model={model} /> : null}
    </View>
  );
}

const FIX_REASON_KEYS = {
  new_api_key_query: `${KEY}.fixNewApiKeyQuery`,
  sub2api_key_query: `${KEY}.fixSub2apiKeyQuery`,
  no_url: `${KEY}.fixNoUrl`,
} as const;

/** 令牌配了只认 key 的地址（或没填地址）：说该用哪个，每个账户查询一个「改用 …」；缺用户 ID 时说补上。 */
function BalanceFixNotice({
  fix,
  model,
}: {
  fix: NonNullable<ConnectionFormState["balanceFix"]>;
  model: ConnectionFormModel;
}) {
  const { t } = useTranslation();
  if (fix.kind === "user_id") {
    return (
      <Text
        variant="caption"
        color="foregroundMuted"
        accessibilityLiveRegion="polite"
        testID="api-endpoint-connection-balance-fix"
      >
        {t(`${KEY}.fixUserId`)}
      </Text>
    );
  }
  return (
    <View
      style={styles.fix}
      accessibilityLiveRegion="polite"
      testID="api-endpoint-connection-balance-fix"
    >
      <Text variant="caption" color="statusWarning">
        {t(FIX_REASON_KEYS[fix.reason])}
      </Text>
      {fix.useUrls.length > 0 ? (
        <View style={styles.fixActions}>
          {fix.useUrls.map((url) => (
            <UseUrlButton key={url} url={url} model={model} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function UseUrlButton({ url, model }: { url: string; model: ConnectionFormModel }) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => model.useBalanceUrl(url), [model, url]);
  return (
    <Button
      variant="outline"
      size="sm"
      onPress={handlePress}
      testID="api-endpoint-connection-balance-use-url"
    >
      {t(`${KEY}.useUrl`, { url })}
    </Button>
  );
}

/** 「自动识别」的结果：试中了说是哪种中转并写出查到的余额；都不中逐个写出试过的地址与原因。 */
function DetectResult({ detect }: { detect: ConnectionFormState["balanceDetect"] }) {
  const { t } = useTranslation();
  if (detect.status === "idle" || detect.status === "detecting") return null;
  if (detect.status === "failed") {
    return (
      <Text
        variant="caption"
        color="statusDanger"
        selectable
        style={styles.result}
        accessibilityLiveRegion="polite"
        testID="api-endpoint-connection-detect-balance-result"
      >
        {detect.message}
      </Text>
    );
  }
  if (detect.status === "found") {
    const kind = balanceUrlPath(detect.url) === NEW_API_BALANCE_QUERIES.key ? "new-api" : "sub2api";
    return (
      <View
        style={styles.result}
        accessibilityLiveRegion="polite"
        testID="api-endpoint-connection-detect-balance-result"
      >
        <Text variant="caption" color="foregroundMuted">
          {t(`${KEY}.detectFound`, { kind })}
        </Text>
        <Text weight="medium" selectable>
          {readingLine({ t, reading: detect.reading })}
        </Text>
      </View>
    );
  }
  return (
    <View
      style={styles.result}
      accessibilityLiveRegion="polite"
      testID="api-endpoint-connection-detect-balance-result"
    >
      <Text variant="caption" color="statusWarning">
        {t(`${KEY}.detectMissed`)}
      </Text>
      {detect.attempts.map((attempt) => (
        <AttemptLine key={attempt.url} attempt={attempt} />
      ))}
    </View>
  );
}

/** 试过的一个地址：路径与没查到的原因，对方的原话在下一行。 */
function AttemptLine({ attempt }: { attempt: ApiEndpointBalanceUrlAttempt }) {
  const { t } = useTranslation();
  const detail = attempt.reading.failure?.detail ?? null;
  return (
    <View testID="api-endpoint-connection-detect-balance-attempt">
      <Text variant="caption" color="foregroundMuted" selectable>
        {t(`${KEY}.detectAttempt`, {
          path: balanceUrlPath(attempt.url),
          reason: failureTitle({ t, failure: attempt.reading.failure }),
        })}
      </Text>
      {detail ? (
        <Text variant="caption" color="foregroundMuted" selectable numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

function CheckResult({ check }: { check: ConnectionFormState["balanceCheck"] }) {
  const { t } = useTranslation();
  if (check.status === "idle" || check.status === "checking") return null;
  if (check.status === "failed") {
    return (
      <Text
        variant="caption"
        color="statusDanger"
        selectable
        style={styles.result}
        accessibilityLiveRegion="polite"
        testID="api-endpoint-connection-balance-result"
      >
        {check.message}
      </Text>
    );
  }
  const { reading } = check;
  if (reading.status === "ok") {
    return (
      <Text
        weight="medium"
        selectable
        style={styles.result}
        accessibilityLiveRegion="polite"
        testID="api-endpoint-connection-balance-result"
      >
        {readingLine({ t, reading })}
      </Text>
    );
  }
  if (reading.status !== "failed") {
    return (
      <Text
        variant="caption"
        color="foregroundMuted"
        style={styles.result}
        accessibilityLiveRegion="polite"
        testID="api-endpoint-connection-balance-result"
      >
        {t(`${KEY}.nothingToAsk`)}
      </Text>
    );
  }
  const hint = hintOf({ t, failure: reading.failure });
  const detail = reading.failure?.detail ?? null;
  return (
    <View
      style={styles.result}
      accessibilityLiveRegion="polite"
      testID="api-endpoint-connection-balance-result"
    >
      <Text variant="caption" color="statusWarning">
        {failureTitle({ t, failure: reading.failure })}
      </Text>
      {hint ? (
        <Text variant="caption" color="foregroundMuted">
          {hint}
        </Text>
      ) : null}
      {detail ? (
        <Text variant="caption" color="foregroundMuted" selectable numberOfLines={3}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/** 读到的各项写成一行：「余额 $7.50」「Used 90% · Left $12.00」（照 magpie 编辑器的就地结果）。 */
function readingLine(input: { t: TFunction; reading: ApiEndpointBalanceReading }): string {
  const { t, reading } = input;
  if (reading.items.length === 0) return t("settings.apiEndpoints.balance.noItems");
  return reading.items.map((item) => `${itemLabel({ t, item })} ${item.text}`).join(" · ");
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  // 窄窗口里放不下时地址框换到下一行占满整行，地址的结尾看得见。
  urlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  flex: {
    flex: 1,
    minWidth: 260,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tokenBox: {
    flex: 1,
    minWidth: 0,
  },
  // 同冷却设置的分段：描一圈输入框的边，浅色对话框里也看得出这一组。
  segmentTrack: {
    borderWidth: 1,
    borderColor: theme.colors.borderInput,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  fix: {
    gap: theme.spacing[2],
  },
  fixActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  result: {
    flex: 1,
    minWidth: 160,
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
  },
}));
