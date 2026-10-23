import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Text, type TextColor } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  UsageRequestsExport,
  UsageRequestsExportFailure,
} from "@/hooks/use-usage-requests-export";
import type { UsageRequestsExportSkip } from "@/usage-stats/requests-export";

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * Export CSV at the Requests tab's foot, one line high in every state so the
 * card never grows: the button keeps its width while it spins, and a failure
 * or the hosts a saved file left out sit beside it on the same line, cut with
 * an ellipsis, the full detail in a tooltip, until dismissed or exported again.
 */
export function UsageRequestsExportBar({ exporter }: { exporter: UsageRequestsExport }) {
  const { t } = useTranslation();
  const { state, start, dismiss } = exporter;
  return (
    <View style={styles.bar}>
      <ExportButton exporting={state.status === "exporting"} onPress={start} />
      {state.status === "failed" ? (
        <ExportNote
          color="statusDanger"
          sentence={t("usage.requests.export.failed")}
          detail={failureDetail(state.failure, t)}
          testID="usage-requests-export-error"
          onDismiss={dismiss}
          onRetry={start}
        />
      ) : null}
      {state.status === "partial" ? (
        <ExportNote
          color="statusWarning"
          sentence={t("usage.requests.export.notIncluded", {
            hosts: state.skipped
              .map((skip) =>
                t("usage.requests.export.hostReason", {
                  host: skip.serverName,
                  reason: t(`usage.requests.export.${skip.reason.kind}`),
                }),
              )
              .join(t("usage.requests.export.hostSeparator")),
          })}
          detail={errorsDetail(state.skipped)}
          testID="usage-requests-export-partial"
          onDismiss={dismiss}
          onRetry={null}
        />
      ) : null}
    </View>
  );
}

/**
 * The button is as wide as the wider of its two looks, measured by copies of
 * both in a zero-height box under it, so neither the spinner nor the longer
 * label moves anything.
 */
function ExportButton({ exporting, onPress }: { exporting: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const idle = t("usage.requests.export.button");
  const busy = t("usage.requests.export.exporting");
  return (
    <View style={styles.buttonColumn}>
      <Button
        variant="outline"
        size="sm"
        loading={exporting}
        onPress={onPress}
        testID="usage-requests-export"
      >
        {exporting ? busy : idle}
      </Button>
      <View
        style={styles.widthProbe}
        pointerEvents="none"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
      >
        <Button variant="outline" size="sm" disabled focusable={false}>
          {idle}
        </Button>
        <Button variant="outline" size="sm" loading focusable={false}>
          {busy}
        </Button>
      </View>
    </View>
  );
}

function ExportNote({
  color,
  sentence,
  detail,
  testID,
  onRetry,
  onDismiss,
}: {
  color: TextColor;
  sentence: string;
  detail: string | null;
  testID: string;
  onRetry: (() => void) | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.note}>
      <Tooltip enabledOnMobile enabledOnDesktop={detail !== null}>
        <TooltipTrigger asChild>
          <View style={styles.message}>
            <Text variant="caption" color={color} numberOfLines={1} testID={testID}>
              {sentence}
              {detail === null ? null : (
                <Text variant="caption" color="foregroundMuted" testID={`${testID}-detail`}>
                  {` · ${detail}`}
                </Text>
              )}
            </Text>
          </View>
        </TooltipTrigger>
        {detail === null ? null : (
          <TooltipContent>
            <Text variant="caption">{detail}</Text>
          </TooltipContent>
        )}
      </Tooltip>
      {onRetry ? (
        <Button variant="ghost" size="sm" onPress={onRetry} testID="usage-requests-export-retry">
          {t("common.actions.retry")}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        leftIcon={X}
        onPress={onDismiss}
        accessibilityLabel={t("common.actions.dismiss")}
        testID="usage-requests-export-dismiss"
      />
    </View>
  );
}

/** The raw words behind a failure: what saving said, or each host and why it gave nothing. */
function failureDetail(failure: UsageRequestsExportFailure, t: Translate): string | null {
  if (failure.kind === "save") return failure.message;
  return skipsDetail(failure.skipped, t);
}

/** What the hosts that answered with an error said; the offline ones are named in the note already. */
function errorsDetail(skipped: readonly UsageRequestsExportSkip[]): string | null {
  const lines: string[] = [];
  for (const skip of skipped) {
    if (skip.reason.kind === "error") lines.push(`${skip.serverName}: ${skip.reason.message}`);
  }
  return lines.length > 0 ? lines.join("; ") : null;
}

function skipsDetail(skipped: readonly UsageRequestsExportSkip[], t: Translate): string | null {
  const single = skipped.length === 1;
  const lines = skipped.map((skip) => {
    if (skip.reason.kind === "error") {
      return single ? skip.reason.message : `${skip.serverName}: ${skip.reason.message}`;
    }
    return t("usage.requests.export.hostReason", {
      host: skip.serverName,
      reason: t("usage.requests.export.offline"),
    });
  });
  return lines.length > 0 ? lines.join("; ") : null;
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[3],
  },
  buttonColumn: {
    flexShrink: 0,
  },
  widthProbe: {
    height: 0,
    overflow: "hidden",
    opacity: 0,
  },
  note: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  message: {
    flexShrink: 1,
    minWidth: 0,
    marginRight: theme.spacing[1],
  },
}));
