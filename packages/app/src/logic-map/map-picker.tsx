import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceLogicMapSummary } from "@getpaseo/protocol/messages";
import { skipToken } from "@tanstack/react-query";
import { Plus, Workflow } from "lucide-react-native";
import { useCallback, type ReactElement, type ReactNode, type RefObject } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { measureElement } from "@/components/ui/anchor";
import { useMenuContext } from "@/components/ui/menu";
import { useFetchQuery } from "@/data/query";
import { ICON_SIZE, type Theme } from "@/styles/theme";

/** 打开开关时选的图：新建一张，或接着 workspace 里已有的某张。 */
export type LogicMapChoice = { kind: "new" } | { kind: "continue"; mapName: string };

export type LogicMapPickerClient = Pick<DaemonClient, "listWorkspaceLogicMaps">;

const PICKER_WIDTH = 280;

const ThemedPlusIcon = withUnistyles(Plus);
const ThemedWorkflowIcon = withUnistyles(Workflow);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const newMapIcon = <ThemedPlusIcon size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;
const existingMapIcon = <ThemedWorkflowIcon size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;

/** 每次打开都现读一遍：别的对话可能刚建了图或定了标题。 */
function useExistingLogicMaps(input: {
  client: LogicMapPickerClient | null;
  serverId: string;
  workspaceId: string | null;
  open: boolean;
}) {
  const { client, serverId, workspaceId, open } = input;
  return useFetchQuery<WorkspaceLogicMapSummary[]>({
    queryKey: ["logicMap", serverId, workspaceId ?? "", "picker"],
    dataShape: "list",
    staleTimeMs: 0,
    queryFn:
      client && workspaceId && open ? () => client.listWorkspaceLogicMaps(workspaceId) : skipToken,
  });
}

/**
 * 开关不是按下即开的触发器：它的外框交给菜单当锚点，打开由开关自己调 `openPicker`。
 * 弹层往上开时要越过整个输入框，不盖住里面的文字，所以锚点的上沿取输入框的上沿。
 */
function LogicMapPickerAnchor({
  edgeRef,
  children,
}: {
  edgeRef: RefObject<View | null> | null;
  children: (openPicker: () => void) => ReactNode;
}) {
  const { triggerRef, setAnchorRect, setOpen } = useMenuContext("LogicMapPickerAnchor");
  const handleRef = useCallback(
    (node: View | null) => {
      Object.assign(triggerRef, { current: node });
    },
    [triggerRef],
  );
  const openPicker = useCallback(async () => {
    const trigger = triggerRef.current;
    const edge = edgeRef?.current ?? null;
    if (trigger && edge) {
      const [triggerRect, edgeRect] = await Promise.all([
        measureElement(trigger),
        measureElement(edge),
      ]);
      const top = Math.min(triggerRect.y, edgeRect.y);
      setAnchorRect({
        x: triggerRect.x,
        y: top,
        width: triggerRect.width,
        height: triggerRect.y + triggerRect.height - top,
      });
    }
    setOpen(true);
  }, [edgeRef, setAnchorRect, setOpen, triggerRef]);
  const handleOpenPicker = useCallback(() => {
    void openPicker();
  }, [openPicker]);
  return (
    <View ref={handleRef} collapsable={false}>
      {children(handleOpenPicker)}
    </View>
  );
}

interface LogicMapPickerProps {
  client: LogicMapPickerClient | null;
  serverId: string;
  /** 运行中的 Agent 没有 workspace 时为 null，只能新建。 */
  workspaceId: string | null;
  /** 不列出的那张图：草稿自己建好、还没写过的空图由"新建"代表。 */
  hiddenMapName: string | null;
  /** 输入框外框；弹层开在它上方。没有时贴着开关开。 */
  edgeRef: RefObject<View | null> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (choice: LogicMapChoice) => void;
  /** 开关本身，弹层锚在它上面；拿到的 `openPicker` 在用户打开开关时调用。 */
  children: (openPicker: () => void) => ReactNode;
}

/** 打开逻辑图开关时的选择弹层：第一行"新建"，下面是这个 workspace 已有的图。 */
export function LogicMapPicker({
  client,
  serverId,
  workspaceId,
  hiddenMapName,
  edgeRef,
  open,
  onOpenChange,
  onChoose,
  children,
}: LogicMapPickerProps): ReactElement {
  const { t } = useTranslation();
  const listQuery = useExistingLogicMaps({ client, serverId, workspaceId, open });
  const maps = (listQuery.data ?? []).filter((map) => map.name !== hiddenMapName);
  const chooseNew = useCallback(() => onChoose({ kind: "new" }), [onChoose]);
  const existingSection = renderExistingSection({
    maps,
    status: workspaceId ? listQuery.status : "success",
    isFetching: listQuery.isFetching,
    onChoose,
    t,
  });
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <LogicMapPickerAnchor edgeRef={edgeRef}>{children}</LogicMapPickerAnchor>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        width={PICKER_WIDTH}
        sheetTitle={t("logicMap.picker.title")}
        testID="composer-logic-map-picker"
      >
        <DropdownMenuItem
          leading={newMapIcon}
          onSelect={chooseNew}
          testID="composer-logic-map-picker-new"
        >
          {t("logicMap.picker.newMap")}
        </DropdownMenuItem>
        {existingSection}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderExistingSection(input: {
  maps: readonly WorkspaceLogicMapSummary[];
  status: "pending" | "error" | "success";
  isFetching: boolean;
  onChoose: (choice: LogicMapChoice) => void;
  t: TFunction;
}): ReactElement | null {
  const { maps, status, isFetching, onChoose, t } = input;
  if (status === "error") {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuHint testID="composer-logic-map-picker-failed">
          {t("logicMap.picker.listFailed")}
        </DropdownMenuHint>
      </>
    );
  }
  if (maps.length === 0) {
    if (status === "success" && !isFetching) return null;
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuHint testID="composer-logic-map-picker-loading">
          {t("logicMap.picker.loading")}
        </DropdownMenuHint>
      </>
    );
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("logicMap.picker.continueSection")}</DropdownMenuLabel>
      {maps.map((map) => (
        <ExistingMapItem key={map.name} map={map} onChoose={onChoose} />
      ))}
    </>
  );
}

function ExistingMapItem({
  map,
  onChoose,
}: {
  map: WorkspaceLogicMapSummary;
  onChoose: (choice: LogicMapChoice) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    () => onChoose({ kind: "continue", mapName: map.name }),
    [map.name, onChoose],
  );
  // 还没定标题的图都叫"未命名逻辑图"，附上文件夹名才分得开。
  const description = map.title === null ? map.name : undefined;
  return (
    <DropdownMenuItem
      leading={existingMapIcon}
      description={description}
      onSelect={handleSelect}
      testID={`composer-logic-map-picker-map-${map.name}`}
    >
      {map.title ?? t("logicMap.panel.untitled")}
    </DropdownMenuItem>
  );
}
