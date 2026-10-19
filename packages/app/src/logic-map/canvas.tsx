import { memo, useCallback, useState, type ComponentType } from "react";
import { Text, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { Flag, House, Repeat, Split, TextAlignStart, TriangleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LOGIC_MAP_LIGHT_PALETTE } from "@/styles/logic-map-palette";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { arrowHeadPath, roundedEdgePath } from "./edge-path";
import {
  LOGIC_MAP_CARD,
  type LogicMapBranch,
  type LogicMapEdgeRoute,
  type LogicMapLayout,
  type LogicMapNodeBox,
} from "./layout";

export const LOGIC_MAP_ICON_SIZE = 14;
export const LOGIC_MAP_ICON_STROKE = 2.4;
// 图标块上的图形两种主题都是白色，静态取值即可。
export const LOGIC_MAP_GLYPH_COLOR = LOGIC_MAP_LIGHT_PALETTE.glyph;

type CardTone = "startEnd" | "decision" | "step" | "failure" | "subgraph";

interface GlyphProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const KIND_GLYPHS: Record<LogicMapNodeBox["kind"], ComponentType<GlyphProps>> = {
  start: House,
  end: Flag,
  decision: Split,
  step: TextAlignStart,
  subgraph: Repeat,
};

function cardTone(node: LogicMapNodeBox): CardTone {
  if (node.failure) return "failure";
  if (node.kind === "start" || node.kind === "end") return "startEnd";
  return node.kind;
}

/**
 * 一层逻辑图按排版结果原大画出：底下一层 SVG 画连线，上面按坐标摆卡片。外层的可缩放视图负责缩放和拖动。
 */
export const LogicMapCanvas = memo(function LogicMapCanvas({ layout }: { layout: LogicMapLayout }) {
  const sizeStyle = inlineUnistylesStyle({ width: layout.width, height: layout.height });
  return (
    <View style={[styles.stage, sizeStyle]} testID="logic-map-stage">
      <ThemedEdges layout={layout} />
      {layout.nodes.map((node) => (
        <LogicMapNodeCard key={node.id} node={node} />
      ))}
    </View>
  );
});

function LogicMapEdges({
  layout,
  edgeColor,
  failureColor,
}: {
  layout: LogicMapLayout;
  edgeColor?: string;
  failureColor?: string;
}) {
  return (
    <Svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={styles.edges}
      pointerEvents="none"
    >
      {layout.edges.map((route) => (
        <EdgeShape key={route.id} route={route} color={route.failure ? failureColor : edgeColor} />
      ))}
    </Svg>
  );
}

const ThemedEdges = withUnistyles(LogicMapEdges, (theme: Theme) => ({
  edgeColor: theme.colors.logicMap.edge,
  failureColor: theme.colors.logicMap.failure,
}));

function EdgeShape({ route, color }: { route: LogicMapEdgeRoute; color?: string }) {
  const end = route.points[route.points.length - 1];
  return (
    <G testID={`logic-map-edge-${route.id}`}>
      <Path d={roundedEdgePath(route.points)} fill="none" stroke={color} strokeWidth={2} />
      <Path d={arrowHeadPath(end)} fill={color} />
    </G>
  );
}

const LogicMapNodeCard = memo(function LogicMapNodeCard({ node }: { node: LogicMapNodeBox }) {
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const tone = cardTone(node);
  const Glyph = node.failure ? TriangleAlert : KIND_GLYPHS[node.kind];
  const positionStyle = inlineUnistylesStyle({
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
  });
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View
          style={[styles.card, hovered && styles.cardHovered, positionStyle]}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          testID={`logic-map-node-${node.id}`}
        >
          <View style={styles.header}>
            <View style={[styles.iconBlock, toneStyles[tone]]}>
              <Glyph
                size={LOGIC_MAP_ICON_SIZE}
                color={LOGIC_MAP_GLYPH_COLOR}
                strokeWidth={LOGIC_MAP_ICON_STROKE}
              />
            </View>
            <Text style={styles.title} numberOfLines={1} testID={`logic-map-node-title-${node.id}`}>
              {node.title}
            </Text>
          </View>
          {node.branches.length > 0 ? (
            <View style={styles.rows}>
              {node.branches.map((branch, index) => (
                <BranchRow
                  key={`${branch.targetId}-${branch.label}`}
                  branch={branch}
                  testID={`logic-map-branch-${node.id}-${index}`}
                />
              ))}
            </View>
          ) : null}
          <NodeTags node={node} />
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6} testID="logic-map-node-tooltip">
        <Text style={styles.tooltipText}>{node.title}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

function BranchRow({ branch, testID }: { branch: LogicMapBranch; testID: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {t(`logicMap.panel.branch.${branch.label}`)}
      </Text>
      <View style={styles.condition}>
        <Text
          style={[styles.conditionText, branch.failure && styles.conditionTextFailure]}
          numberOfLines={1}
        >
          {branch.condition ?? ""}
        </Text>
      </View>
      <View style={[styles.exitDot, branch.failure && styles.exitDotFailure]} />
    </View>
  );
}

function NodeTags({ node }: { node: LogicMapNodeBox }) {
  const { t } = useTranslation();
  if (node.subgraphNodeCount === null && !node.pendingLink) return null;
  return (
    <View style={styles.tags}>
      {node.subgraphNodeCount !== null ? (
        <View style={styles.subgraphTag}>
          <Text style={styles.subgraphTagText} numberOfLines={1}>
            {t(
              node.subgraphNodeCount === 1
                ? "logicMap.panel.subgraphTagOne"
                : "logicMap.panel.subgraphTagMany",
              { count: node.subgraphNodeCount },
            )}
          </Text>
        </View>
      ) : null}
      {node.pendingLink ? (
        <View style={styles.pendingTag}>
          <Text style={styles.pendingTagText} numberOfLines={1}>
            {t("logicMap.panel.pendingLink")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const toneStyles = StyleSheet.create((theme) => ({
  startEnd: { backgroundColor: theme.colors.logicMap.startEnd },
  decision: { backgroundColor: theme.colors.logicMap.decision },
  step: { backgroundColor: theme.colors.logicMap.step },
  failure: { backgroundColor: theme.colors.logicMap.failure },
  subgraph: { backgroundColor: theme.colors.logicMap.subgraph },
}));

// 画布内部是 docs/design.md §14 登记的颜色例外：颜色取 theme.colors.logicMap，字号沿用 typeScale。
const styles = StyleSheet.create((theme) => ({
  stage: {
    position: "relative",
  },
  edges: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  card: {
    position: "absolute",
    padding: LOGIC_MAP_CARD.padding,
    borderRadius: LOGIC_MAP_CARD.radius,
    backgroundColor: theme.colors.logicMap.card,
    boxShadow: theme.colors.logicMap.cardShadow,
  },
  cardHovered: {
    boxShadow: theme.colors.logicMap.cardShadowHover,
  },
  header: {
    height: LOGIC_MAP_CARD.headerHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconBlock: {
    width: LOGIC_MAP_CARD.headerHeight,
    height: LOGIC_MAP_CARD.headerHeight,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    ...theme.typeScale.body,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.logicMap.title,
  },
  rows: {
    marginTop: LOGIC_MAP_CARD.rowsTop,
    gap: LOGIC_MAP_CARD.rowGap,
  },
  row: {
    height: LOGIC_MAP_CARD.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  rowLabel: {
    flexShrink: 0,
    minWidth: theme.spacing[6],
    ...theme.typeScale.micro,
    color: theme.colors.logicMap.branchLabel,
  },
  condition: {
    flex: 1,
    minWidth: 0,
    height: LOGIC_MAP_CARD.rowHeight,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.logicMap.conditionBackground,
  },
  conditionText: {
    ...theme.typeScale.caption,
    color: theme.colors.logicMap.conditionText,
  },
  conditionTextFailure: {
    color: theme.colors.logicMap.failureText,
  },
  // 出口圆点压在卡片右缘上：行的右边离卡片右缘一个内边距，圆点再往外半个自身宽度。
  exitDot: {
    position: "absolute",
    right: -(LOGIC_MAP_CARD.padding + 5),
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.colors.logicMap.card,
    backgroundColor: theme.colors.logicMap.edge,
  },
  exitDotFailure: {
    backgroundColor: theme.colors.logicMap.failure,
  },
  tags: {
    marginTop: LOGIC_MAP_CARD.tagTop,
    height: LOGIC_MAP_CARD.tagHeight,
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  subgraphTag: {
    height: LOGIC_MAP_CARD.tagHeight,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: 5,
    backgroundColor: theme.colors.logicMap.subgraphTagBackground,
  },
  subgraphTagText: {
    ...theme.typeScale.micro,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.logicMap.subgraphTagText,
  },
  pendingTag: {
    height: LOGIC_MAP_CARD.tagHeight,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: 5,
    borderWidth: 1,
    borderColor: theme.colors.logicMap.pendingTagBorder,
    backgroundColor: theme.colors.logicMap.pendingTagBackground,
  },
  pendingTagText: {
    ...theme.typeScale.micro,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.logicMap.pendingTagText,
  },
  tooltipText: {
    ...theme.typeScale.label,
    color: theme.colors.foreground,
  },
}));
