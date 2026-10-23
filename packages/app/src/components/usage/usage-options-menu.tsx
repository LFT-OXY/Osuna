import { SlidersHorizontal } from "lucide-react-native";
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { UsageExchangeRate } from "@getpaseo/protocol/usage/rpc-schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import type { UsageCurrency } from "@/usage/preferences";
import {
  useUsageChineseUnitsChoice,
  useUsageCurrencyChoice,
  useUsageExchangeRate,
  type UsageExchangeRateState,
} from "@/usage-stats/use-usage-money";

/** Defined once so the trigger does not take a new style function every render. */
function triggerStyle({ hovered, open }: MenuTriggerState): StyleProp<ViewStyle> {
  return [styles.trigger, (hovered || open) && styles.triggerHovered];
}

/**
 * The Usage page's display options: what estimated costs are shown in, and, in a
 * Chinese UI, token counts in 万 / 亿. Both are kept on this device. Hidden when it
 * would be empty: no host can answer the exchange rate and the UI is not Chinese.
 */
export function UsageOptionsMenu(): ReactElement | null {
  const { t, i18n } = useTranslation();
  const currency = useUsageCurrencyChoice();
  const units = useUsageChineseUnitsChoice();
  const rate = useUsageExchangeRate();
  const { setCurrency } = currency;
  const { setOn } = units;
  const chooseUsd = useCallback(() => setCurrency("usd"), [setCurrency]);
  const chooseCny = useCallback(() => setCurrency("cny"), [setCurrency]);
  const toggleUnits = useCallback(() => setOn(!units.isOn), [setOn, units.isOn]);
  const unitsSwitch = useMemo(
    () => (
      <Switch
        value={units.isOn}
        onValueChange={setOn}
        accessibilityLabel={t("usage.options.chineseUnits")}
        testID="usage-options-chinese-units-switch"
      />
    ),
    [setOn, t, units.isOn],
  );

  if (!currency.isAvailable && !units.isAvailable) return null;

  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("usage.options.title")}
        style={triggerStyle}
        testID="usage-options-trigger"
      >
        {({ hovered, open }: MenuTriggerState) => (
          <SlidersHorizontal
            size={14}
            color={hovered || open ? styles.glyphHovered.color : styles.glyph.color}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        minWidth={280}
        sheetTitle={t("usage.options.title")}
        testID="usage-options-menu"
      >
        {currency.isAvailable ? (
          <>
            <DropdownMenuLabel>{t("usage.options.currency")}</DropdownMenuLabel>
            <DropdownMenuItem
              selected={currency.currency === "usd"}
              showSelectedCheck
              closeOnSelect={false}
              onSelect={chooseUsd}
              testID="usage-options-currency-usd"
            >
              {t("usage.options.usd")}
            </DropdownMenuItem>
            <DropdownMenuItem
              selected={currency.currency === "cny"}
              showSelectedCheck
              closeOnSelect={false}
              description={describeRate({
                currency: currency.currency,
                rate,
                locale: i18n.language,
                t,
              })}
              onSelect={chooseCny}
              testID="usage-options-currency-cny"
            >
              {t("usage.options.cny")}
            </DropdownMenuItem>
          </>
        ) : null}
        {currency.isAvailable && units.isAvailable ? <DropdownMenuSeparator /> : null}
        {units.isAvailable ? (
          <DropdownMenuItem
            trailing={unitsSwitch}
            closeOnSelect={false}
            onSelect={toggleUnits}
            testID="usage-options-chinese-units"
          >
            {t("usage.options.chineseUnits")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * The line under CNY. It is there whichever currency is chosen, so picking one
 * does not change the menu's height: before CNY is chosen nothing is fetched,
 * and the line says when the rate will be.
 */
function describeRate(input: {
  currency: UsageCurrency;
  rate: UsageExchangeRateState;
  locale: string;
  t: Translate;
}): string {
  const { rate, locale, t } = input;
  if (input.currency === "usd" || rate.status === "off") return t("usage.options.rateOnChoose");
  if (rate.status === "loading") return t("usage.options.rateLoading");
  if (rate.status === "error") return t("usage.options.rateFailed");
  return describeFetchedRate({ rate: rate.rate, locale, t });
}

function describeFetchedRate(input: {
  rate: UsageExchangeRate;
  locale: string;
  t: Translate;
}): string {
  const { rate, locale, t } = input;
  if (rate.fallback || rate.fetchedAt === null) {
    return t("usage.options.rateFallback", { rate: String(rate.cnyPerUsd) });
  }
  const values = {
    rate: rate.cnyPerUsd.toFixed(2),
    when: formatFetchedAt(rate.fetchedAt, locale),
  };
  return rate.stale ? t("usage.options.rateStale", values) : t("usage.options.rate", values);
}

/** Today: the time alone; another day: the date and the time (magpie's syncWhen). */
function formatFetchedAt(iso: string, locale: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === new Date().toDateString()) return time;
  return `${at.toLocaleDateString(locale)} ${time}`;
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    trigger: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: palette.controlBorder,
    },
    triggerHovered: {
      borderColor: palette.brand,
    },
    glyph: {
      color: palette.inkFaint,
    },
    glyphHovered: {
      color: palette.brand,
    },
  };
});
