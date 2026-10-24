import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  OMP_ROLE_THINKING_LEVELS,
  type OmpModelRole,
} from "@getpaseo/protocol/api-endpoint/omp-model-roles";
import type { ApiEndpointModelRole } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useDefaultModelLabel } from "./default-model-label";
import type { DefaultModelOption, ModelRoleView } from "./internal/agent-settings";

/*
 * OMP 的「模型角色」区（工单 05，照 magpie 的 roles 方块）：每个角色一行，模型与思考档位各一个下拉，
 * 下面一行说空着时 OMP 用什么（magpie app.js 的 FOLLOWS_MODEL 与 OMP_UNSET）。
 */

/** 设成某个模型与档位；null 为清空，交还 OMP。 */
export type ModelRoleChangeHandler = (
  role: OmpModelRole,
  value: ApiEndpointModelRole | null,
) => void;

type UnsetKind = "followsDefault" | "ompPicks" | "followsSlow" | "followsSmol" | "followsTiny";

// 空着时 OMP 用什么：Subagent、小任务、难题跟默认模型；规划、看图由 OMP 自己挑；顾问先用难题的；
// 提交说明、极小任务用小任务的；记忆先用极小任务的，再用小任务的。
const UNSET_KINDS: Record<OmpModelRole, UnsetKind> = {
  task: "followsDefault",
  smol: "followsDefault",
  slow: "followsDefault",
  plan: "ompPicks",
  vision: "ompPicks",
  advisor: "followsSlow",
  commit: "followsSmol",
  tiny: "followsSmol",
  memory: "followsTiny",
};

// 下拉里「空着」「跟会话的档位」的 id：模型 id 与档位 id 都不会是空串。
const UNSET = "";

interface ModelRolesRowsProps {
  providerLabel: string;
  roles: ModelRoleView[];
  options: DefaultModelOption[];
  busy: boolean;
  onChange: ModelRoleChangeHandler;
}

export function ModelRolesRows({
  providerLabel,
  roles,
  options,
  busy,
  onChange,
}: ModelRolesRowsProps) {
  const { t } = useTranslation();
  return (
    <View testID="agent-api-endpoints-model-roles">
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.apiEndpoints.agent.modelRoles.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.apiEndpoints.agent.modelRoles.hint", { agent: providerLabel })}
          </Text>
        </View>
      </View>
      {roles.map((role) => (
        <ModelRoleRow
          key={role.role}
          providerLabel={providerLabel}
          role={role}
          options={options}
          busy={busy}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

interface ModelRoleRowProps {
  providerLabel: string;
  role: ModelRoleView;
  options: DefaultModelOption[];
  busy: boolean;
  onChange: ModelRoleChangeHandler;
}

function ModelRoleRow({ providerLabel, role, options, busy, onChange }: ModelRoleRowProps) {
  const { t } = useTranslation();
  const labelOf = useDefaultModelLabel();
  const isCompact = useIsCompactFormFactor();
  const name = t(`settings.apiEndpoints.agent.modelRoles.roles.${role.role}`);
  const testID = `agent-api-endpoints-role-${role.role}`;
  const unsetModelLabel = t("settings.apiEndpoints.agent.modelRoles.unsetModel");
  const modelOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: UNSET, value: UNSET, label: unsetModelLabel, testID: `${testID}-option-unset` },
      ...options.map((option) => ({
        id: option.id,
        value: option.id,
        label: labelOf(option),
        testID: `${testID}-option-${option.id}`,
      })),
    ],
    [labelOf, options, testID, unsetModelLabel],
  );
  const modelDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: role.model === null ? unsetModelLabel : labelOf(role.model) }),
    [labelOf, role.model, unsetModelLabel],
  );
  const unsetThinkingLabel = t("settings.apiEndpoints.agent.modelRoles.unsetThinking");
  const thinkingOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: UNSET,
        value: UNSET,
        label: unsetThinkingLabel,
        testID: `${testID}-thinking-option-unset`,
      },
      ...OMP_ROLE_THINKING_LEVELS.map((level) => ({
        id: level,
        value: level,
        label: formatThinkingOptionLabel({ id: level }),
        testID: `${testID}-thinking-option-${level}`,
      })),
    ],
    [testID, unsetThinkingLabel],
  );
  const thinkingId = role.thinking ?? UNSET;
  const thinkingDisplay = useMemo<SelectFieldDisplay>(() => {
    const selected = thinkingOptions.find((option) => option.id === thinkingId);
    return { label: selected?.label ?? thinkingId };
  }, [thinkingId, thinkingOptions]);
  const modelId = role.model?.id ?? null;
  const handleModelChange = useCallback(
    (id: string) => {
      if (id === UNSET) onChange(role.role, null);
      else onChange(role.role, { modelId: id, thinkingOptionId: role.thinking });
    },
    [onChange, role.role, role.thinking],
  );
  const handleThinkingChange = useCallback(
    (id: string) => {
      if (modelId === null) return;
      onChange(role.role, { modelId, thinkingOptionId: id === UNSET ? null : id });
    },
    [modelId, onChange, role.role],
  );
  const modelPick = t("settings.apiEndpoints.agent.modelRoles.modelPick", { role: name });
  const thinkingPick = t("settings.apiEndpoints.agent.modelRoles.thinkingPick", { role: name });
  return (
    <View
      style={[settingsStyles.row, settingsStyles.rowBorder, isCompact && styles.rowStacked]}
      testID={testID}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{name}</Text>
        <Text style={settingsStyles.rowHint}>
          {t(`settings.apiEndpoints.agent.modelRoles.unset.${UNSET_KINDS[role.role]}`, {
            agent: providerLabel,
          })}
        </Text>
      </View>
      <View style={isCompact ? styles.selectsStacked : styles.selects}>
        <View style={styles.modelSelect}>
          <SelectField
            field={false}
            label={modelPick}
            value={modelId ?? UNSET}
            selectedDisplay={modelDisplay}
            options={modelOptions}
            onChange={handleModelChange}
            placeholder={name}
            emptyText={t("settings.apiEndpoints.agent.noUsableEndpoint")}
            searchable={modelOptions.length > 6}
            title={modelPick}
            size="sm"
            disabled={busy}
            testID={`${testID}-model`}
            triggerTestID={`${testID}-model-trigger`}
          />
        </View>
        <View style={styles.thinkingSelect}>
          <SelectField
            field={false}
            label={thinkingPick}
            value={thinkingId}
            selectedDisplay={thinkingDisplay}
            options={thinkingOptions}
            onChange={handleThinkingChange}
            placeholder={unsetThinkingLabel}
            emptyText={unsetThinkingLabel}
            title={thinkingPick}
            size="sm"
            // 角色在一个模型上时才有自己的档位（照 magpie）。
            disabled={busy || modelId === null}
            testID={`${testID}-thinking`}
            triggerTestID={`${testID}-thinking-trigger`}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  selects: {
    flexDirection: "row",
    gap: theme.spacing[2],
    width: 380,
    flexShrink: 1,
  },
  // 窄窗口：两个下拉放到说明下面，占满整行。
  rowStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  selectsStacked: {
    flexDirection: "row",
    gap: theme.spacing[2],
    width: "100%",
  },
  modelSelect: {
    flex: 3,
    minWidth: 0,
  },
  thinkingSelect: {
    flex: 2,
    minWidth: 0,
  },
}));
