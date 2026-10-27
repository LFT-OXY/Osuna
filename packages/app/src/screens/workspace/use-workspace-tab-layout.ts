import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import {
  computeWorkspaceTabLayout,
  type WorkspaceTabLayoutMetrics,
  type WorkspaceTabLayoutResult,
} from "@/screens/workspace/workspace-tab-layout";

interface UseWorkspaceTabLayoutInput {
  tabLabelWidths: number[];
  tabCloseSlots?: boolean[];
  viewportWidthOverride?: number | null;
  metrics: WorkspaceTabLayoutMetrics;
  compact: boolean;
}

interface UseWorkspaceTabLayoutResult {
  layout: WorkspaceTabLayoutResult;
}

export function useWorkspaceTabLayout(
  input: UseWorkspaceTabLayoutInput,
): UseWorkspaceTabLayoutResult {
  const { width: viewportWidth } = useWindowDimensions();
  const resolvedViewportWidth =
    typeof input.viewportWidthOverride === "number" && input.viewportWidthOverride > 0
      ? input.viewportWidthOverride
      : viewportWidth;

  const layout = useMemo(
    () =>
      computeWorkspaceTabLayout({
        viewportWidth: resolvedViewportWidth,
        tabLabelWidths: input.tabLabelWidths,
        tabCloseSlots: input.tabCloseSlots,
        metrics: input.metrics,
        compact: input.compact,
      }),
    [
      input.compact,
      input.metrics,
      input.tabCloseSlots,
      input.tabLabelWidths,
      resolvedViewportWidth,
    ],
  );

  return {
    layout,
  };
}
