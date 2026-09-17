import React, { type ComponentProps, type PropsWithChildren, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Copy, Import, MoreVertical } from "lucide-react-native";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedCopy = withUnistyles(Copy);
const ThemedImport = withUnistyles(Import);

const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const importLeadingIcon = <ThemedImport size={14} uniProps={foregroundMutedColorMapping} />;
const MENU_WIDTH = 240;

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

/**
 * What a session row can do besides being opened. The same items serve the
 * hover kebab and the right-click / long-press menu so the two cannot drift.
 */
export interface SessionHistoryRowActions {
  /** Test ids end with this; the row key. */
  rowKey: string;
  onCopyResumeCommand: () => void;
  /** Absent when Paseo already owns the session: importing it again would make a second agent. */
  onImport: (() => void) | null;
  importStatus: "idle" | "pending";
}

type MenuSurface = "context" | "dropdown";

function RowMenuItem({
  surface,
  children,
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & { surface: MenuSurface }
>) {
  if (surface === "context") {
    return <ContextMenuItem {...props}>{children}</ContextMenuItem>;
  }
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

function SessionHistoryRowMenuItems({
  surface,
  rowKey,
  onCopyResumeCommand,
  onImport,
  importStatus,
}: SessionHistoryRowActions & { surface: MenuSurface }): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <RowMenuItem
        surface={surface}
        leading={copyLeadingIcon}
        onSelect={onCopyResumeCommand}
        testID={`session-history-menu-copy-resume-command-${rowKey}`}
      >
        {t("panels.sessionHistory.row.copyResumeCommand")}
      </RowMenuItem>
      {onImport ? (
        <RowMenuItem
          surface={surface}
          leading={importLeadingIcon}
          status={importStatus}
          pendingLabel={t("panels.sessionHistory.row.importing")}
          onSelect={onImport}
          testID={`session-history-menu-import-${rowKey}`}
        >
          {t("panels.sessionHistory.row.importAsAgent")}
        </RowMenuItem>
      ) : null}
    </>
  );
}

/** The kebab at the row's trailing edge; open state is lifted so the row keeps it mounted while the menu is up. */
export function SessionHistoryRowMenu({
  open,
  onOpenChange,
  ...actions
}: SessionHistoryRowActions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("panels.sessionHistory.row.menu")}
        testID={`session-history-kebab-${actions.rowKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={MENU_WIDTH}
        sheetTitle={t("panels.sessionHistory.row.menu")}
      >
        <SessionHistoryRowMenuItems surface="dropdown" {...actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ContextTriggerProps = Omit<ComponentProps<typeof ContextMenuTrigger>, "children">;

/** Wraps the row's press target: a press opens the session, a right click or long press opens the menu. */
export function SessionHistoryRowContextMenu({
  children,
  open,
  onOpenChange,
  rowKey,
  onCopyResumeCommand,
  onImport,
  importStatus,
  ...triggerProps
}: PropsWithChildren<
  SessionHistoryRowActions &
    ContextTriggerProps & {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }
>) {
  const { t } = useTranslation();
  return (
    <ContextMenu open={open} onOpenChange={onOpenChange}>
      <ContextMenuTrigger {...triggerProps}>{children}</ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={MENU_WIDTH}
        sheetTitle={t("panels.sessionHistory.row.menu")}
        testID={`session-history-context-menu-${rowKey}`}
      >
        <SessionHistoryRowMenuItems
          surface="context"
          rowKey={rowKey}
          onCopyResumeCommand={onCopyResumeCommand}
          onImport={onImport}
          importStatus={importStatus}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: theme.borderRadius.base,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
