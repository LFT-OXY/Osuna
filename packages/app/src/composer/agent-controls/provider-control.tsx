import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelProviderGlyph } from "@/components/model-browser";
import { resolveProviderGlyph } from "@/components/provider-icons";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import type { ProviderMenuGroups } from "@/provider-selection/provider-selection";
import { ICON_SIZE, type Theme } from "@/styles/theme";

// 不会和 provider id 撞车的哨兵：选中它只展开或收起「More agents」。
const MORE_AGENTS_OPTION_ID = "\u0000more-agents";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface AgentProviderControlProps {
  /** 空串表示 provider 还没解析出来（列表加载中），按钮显示占位图标。 */
  provider: string;
  providerLabel: string;
  serverId: string | null;
  /** 为 null 时只展示图标：运行中的 Agent 不能换 provider。 */
  menu: ProviderMenuGroups | null;
  onSelectProvider?: (providerId: string) => void;
  disabled: boolean;
  onClose?: () => void;
  /** toolbar 是纯图标按钮；sheet 是 Agent controls sheet 里带名字的一行，列表以 push 叠在 sheet 上。 */
  surface: "toolbar" | "sheet";
}

// 品牌色写死时不需要主题色；没有品牌色的用前景色，占位图标用弱化色。
function resolveTriggerIconColorMapping(input: {
  brandColor: string | null;
  hasProvider: boolean;
}) {
  if (input.brandColor) return undefined;
  return input.hasProvider ? foregroundMapping : foregroundMutedMapping;
}

function buildMenuOptions(input: {
  menu: ProviderMenuGroups;
  moreExpanded: boolean;
  moreLabel: string;
}): ComboboxOption[] {
  const { menu, moreExpanded, moreLabel } = input;
  if (menu.more.length === 0) return menu.flat;
  return [
    ...menu.flat,
    { id: MORE_AGENTS_OPTION_ID, label: moreLabel },
    ...(moreExpanded ? menu.more : []),
  ];
}

export function AgentProviderControl({
  provider,
  providerLabel,
  serverId,
  menu,
  onSelectProvider,
  disabled,
  onClose,
  surface,
}: AgentProviderControlProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);

  const hasProvider = provider.trim().length > 0;
  const glyph = resolveProviderGlyph({ provider, serverId, tone: "brand" });
  const canOpen =
    !disabled &&
    menu !== null &&
    onSelectProvider !== undefined &&
    menu.flat.length + menu.more.length > 0;

  const moreLabel = t("agentControls.provider.moreAgents", { count: menu?.more.length ?? 0 });
  const options = useMemo(
    () => (menu ? buildMenuOptions({ menu, moreExpanded, moreLabel }) : []),
    [menu, moreExpanded, moreLabel],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        // 当前 provider 在折叠区里时直接展开，打勾的那一行要看得见。
        setMoreExpanded(menu?.more.some((item) => item.id === provider) ?? false);
        return;
      }
      onClose?.();
    },
    [menu, onClose, provider],
  );

  const handlePress = useCallback(() => handleOpenChange(!open), [handleOpenChange, open]);

  const handleSelect = useCallback(
    (id: string) => {
      if (id === MORE_AGENTS_OPTION_ID) {
        setMoreExpanded((expanded) => !expanded);
        return;
      }
      onSelectProvider?.(id);
      handleOpenChange(false);
    },
    [handleOpenChange, onSelectProvider],
  );

  const renderOption = useCallback(
    (args: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }): ReactElement => {
      if (args.option.id === MORE_AGENTS_OPTION_ID) {
        return (
          <MoreAgentsRow
            label={args.option.label}
            expanded={moreExpanded}
            active={args.active}
            onPress={args.onPress}
          />
        );
      }
      return (
        <ProviderMenuRow
          option={args.option}
          serverId={serverId}
          selected={args.selected}
          active={args.active}
          onPress={args.onPress}
        />
      );
    },
    [moreExpanded, serverId],
  );

  const accessibilityLabel = hasProvider
    ? t("agentControls.provider.selectWithValue", { value: providerLabel })
    : t("agentControls.provider.select");
  const hint = menu ? t("agentControls.hints.provider") : t("agentControls.hints.providerLocked");

  const isSheet = surface === "sheet";
  const trigger = (
    <AgentControlTrigger
      ref={anchorRef}
      icon={glyph.Icon}
      iconColor={glyph.brandColor ?? undefined}
      iconColorMapping={resolveTriggerIconColorMapping({
        brandColor: glyph.brandColor,
        hasProvider,
      })}
      surface={surface}
      label={t("agentControls.provider.fallback")}
      value={hasProvider ? providerLabel : t("modelSelector.loading")}
      showToolbarLabel={false}
      open={open}
      disabled={!canOpen}
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel}
      testID={isSheet ? "agent-controls-provider" : "agent-provider-selector"}
    />
  );

  return (
    <>
      {isSheet ? (
        trigger
      ) : (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            {trigger}
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{hint}</Text>
          </TooltipContent>
        </Tooltip>
      )}
      {menu ? (
        <Combobox
          options={options}
          value={provider}
          onSelect={handleSelect}
          searchable={false}
          keepOpenOnSelect
          title={isSheet ? t("agentControls.provider.fallback") : undefined}
          presentation={isSheet ? "push" : undefined}
          open={open}
          onOpenChange={handleOpenChange}
          anchorRef={anchorRef}
          desktopPlacement="top-start"
          desktopMinWidth={220}
          renderOption={renderOption}
        />
      ) : null}
    </>
  );
}

function ProviderMenuRow({
  option,
  serverId,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  serverId: string | null;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const leadingSlot = useMemo(
    () => (
      <ModelProviderGlyph
        provider={option.id}
        serverId={serverId}
        size={ICON_SIZE.md}
        tone="brand"
      />
    ),
    [option.id, serverId],
  );
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
      testID={`agent-provider-option-${option.id}`}
    />
  );
}

function MoreAgentsRow({
  label,
  expanded,
  active,
  onPress,
}: {
  label: string;
  expanded: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const trailingSlot = useMemo(
    () =>
      expanded ? (
        <ThemedChevronDown size={ICON_SIZE.md} uniProps={foregroundMutedMapping} />
      ) : (
        <ThemedChevronRight size={ICON_SIZE.md} uniProps={foregroundMutedMapping} />
      ),
    [expanded],
  );
  return (
    <ComboboxItem
      label={label}
      active={active}
      onPress={onPress}
      trailingSlot={trailingSlot}
      testID="agent-provider-more"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
