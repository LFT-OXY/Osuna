import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Text, type TextColor } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  UsageRequestsExport,
  UsageRequestsExportFailure,
} from "@/hooks/use-usage-requests-export";
import type { UsageRequestsExportSkip } from "@/usage-stats/requests-export";

/** How many lines a compact layout keeps below the button for the note. */
const COMPACT_NOTE_LINES = 2;

type Translate = ReturnType<typeof useTranslation>["t"];

/** What sits beside the button after an export: a failure, or the hosts a saved file left out. */
interface ExportNoteContent {
  color: TextColor;
  sentence: string;
  /** Every host and why, or what saving said; shown muted and in a tooltip. */
  detail: string | null;
  testID: string;
  onRetry: (() => void) | null;
}

/**
 * Export CSV at the Requests tab's foot. Its height is the same in every state:
 * the button keeps its width while it spins; on a wide layout a failure or the
 * hosts a saved file left out sit beside it on one line, cut with an ellipsis;
 * on a compact one two lines below the button are always reserved and the
 * note with its detail wraps there, cut after the second. The full detail is
 * in a tooltip. A note stays until
 * dismissed or exported again.
 */
export function UsageRequestsExportBar({ exporter }: { exporter: UsageRequestsExport }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { state, start, dismiss } = exporter;
  let note: ExportNoteContent | null = null;
  if (state.status === "failed") {
    note = {
      color: "statusDanger",
      sentence: t("usage.requests.export.failed"),
      detail: failureDetail(state.failure, t),
      testID: "usage-requests-export-error",
      onRetry: start,
    };
  } else if (state.status === "partial") {
    note = {
      color: "statusWarning",
      sentence: t("usage.requests.export.notIncluded", {
        hosts: state.skipped
          .map((skip) =>
            t("usage.requests.export.hostReason", {
              host: skip.serverName,
              reason: t(`usage.requests.export.${skip.reason.kind}`),
            }),
          )
          .join(t("usage.requests.export.hostSeparator")),
      }),
      detail: skipsDetail(state.skipped, t, { named: true }),
      testID: "usage-requests-export-partial",
      onRetry: null,
    };
  }
  const button = <ExportButton exporting={state.status === "exporting"} onPress={start} />;

  if (isCompact) {
    return (
      <View style={styles.compactBar} testID="usage-requests-export-bar">
        <View style={styles.bar}>
          {button}
          {note ? (
            <View style={styles.compactActions}>
              <NoteActions onRetry={note.onRetry} onDismiss={dismiss} />
            </View>
          ) : null}
        </View>
        <View style={styles.reservedLine}>
          {note ? <NoteMessage note={note} inline={false} /> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.bar} testID="usage-requests-export-bar">
      {button}
      {note ? (
        <View style={styles.note}>
          <NoteMessage note={note} inline />
          <NoteActions onRetry={note.onRetry} onDismiss={dismiss} />
        </View>
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

/**
 * The note's words with the detail muted after them: inline on one line, in
 * the compact reserved lines on at most two. The tooltip holds the whole
 * detail and opens on press on a phone.
 */
function NoteMessage({ note, inline }: { note: ExportNoteContent; inline: boolean }) {
  const { detail, testID } = note;
  return (
    <Tooltip enabledOnMobile enabledOnDesktop={detail !== null}>
      <TooltipTrigger asChild>
        <View style={inline ? styles.message : null}>
          <Text
            variant="caption"
            color={note.color}
            numberOfLines={inline ? 1 : COMPACT_NOTE_LINES}
            testID={testID}
          >
            {note.sentence}
            {detail !== null ? (
              <Text variant="caption" color="foregroundMuted" testID={`${testID}-detail`}>
                {` · ${detail}`}
              </Text>
            ) : null}
          </Text>
        </View>
      </TooltipTrigger>
      {detail === null ? null : (
        <TooltipContent testID={`${testID}-tooltip`}>
          <Text variant="caption">{detail}</Text>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function NoteActions({
  onRetry,
  onDismiss,
}: {
  onRetry: (() => void) | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
}

/** The raw words behind a failure: what saving said, or each host and why it gave nothing. */
function failureDetail(failure: UsageRequestsExportFailure, t: Translate): string | null {
  if (failure.kind === "save") return failure.message;
  return skipsDetail(failure.skipped, t, { named: failure.skipped.length > 1 });
}

/** Every left-out host and why, offline ones too; `named: false` drops the name of a lone host's error. */
function skipsDetail(
  skipped: readonly UsageRequestsExportSkip[],
  t: Translate,
  { named }: { named: boolean },
): string | null {
  const lines = skipped.map((skip) => {
    if (skip.reason.kind === "error") {
      return named ? `${skip.serverName}: ${skip.reason.message}` : skip.reason.message;
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
  compactBar: {
    gap: theme.spacing[1],
  },
  compactActions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
  },
  reservedLine: {
    // 窄屏常留两行：说明与原因出现、消失都不改变卡片高度。
    height: theme.typeScale.caption.lineHeight * COMPACT_NOTE_LINES,
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
