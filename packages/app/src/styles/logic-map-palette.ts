/**
 * 逻辑图画布的颜色。docs/design.md §14 登记的例外：只用在画布内部（底色、点阵、卡片、图标块、连线、
 * 卡片里的标签），面板头部、标签栏和弹层仍用应用主题。浅色照搬 Dify / Coze（用户在原型阶段选定）；
 * 深色按同样的色相取亮一档，卡片比画布亮一级。和 usage-palette 一样挂在主题上（`theme.colors.logicMap`），
 * Unistyles 才会在切换主题时跟着换。
 */
export interface LogicMapCanvasPalette {
  canvas: string;
  dot: string;
  card: string;
  /** 卡片投影；深色主题在最前面多一圈 1px 半透明亮边，卡片才和画布分得开。 */
  cardShadow: string;
  cardShadowHover: string;
  /** 选中：2px 蓝色外圈，不加粗、不放大。 */
  cardShadowSelected: string;
  title: string;
  /** 白色图形放在彩色图标块上，两种主题都是白色。 */
  glyph: string;
  startEnd: string;
  decision: string;
  step: string;
  failure: string;
  failureText: string;
  subgraph: string;
  subgraphTagBackground: string;
  subgraphTagText: string;
  edge: string;
  pendingTagBackground: string;
  pendingTagBorder: string;
  pendingTagText: string;
  /** "没有文档"标签：灰底虚线框，和黄色的"未指向文档"分开。 */
  missingDocTagBackground: string;
  missingDocTagBorder: string;
  missingDocTagText: string;
  branchLabel: string;
  conditionBackground: string;
  conditionText: string;
  /** 主机太旧时状态卡片的图标块。 */
  neutral: string;
  skeleton: string;
  muted: string;
}

export const LOGIC_MAP_LIGHT_PALETTE: LogicMapCanvasPalette = {
  canvas: "#f2f4f7",
  dot: "#d0d5dd",
  card: "#ffffff",
  cardShadow: "0 1px 2px #1018280f, 0 1px 3px #1018281a",
  cardShadowHover: "0 4px 8px -2px #1018281a, 0 2px 4px -2px #1018280f",
  cardShadowSelected: "0 0 0 2px #2970ff, 0 4px 8px -2px #1018281a",
  title: "#101828",
  glyph: "#ffffff",
  startEnd: "#2970ff",
  decision: "#06aed4",
  step: "#6172f3",
  failure: "#f04438",
  failureText: "#d92d20",
  subgraph: "#f79009",
  subgraphTagBackground: "#fef0c7",
  subgraphTagText: "#b54708",
  edge: "#4d53e8",
  pendingTagBackground: "#fffaeb",
  pendingTagBorder: "#fedf89",
  pendingTagText: "#b54708",
  missingDocTagBackground: "#f2f4f7",
  missingDocTagBorder: "#98a2b3",
  missingDocTagText: "#475467",
  branchLabel: "#98a2b3",
  conditionBackground: "#f2f4f7",
  conditionText: "#344054",
  neutral: "#98a2b3",
  skeleton: "#eaecf0",
  muted: "#667085",
};

export const LOGIC_MAP_DARK_PALETTE: LogicMapCanvasPalette = {
  canvas: "#16171b",
  dot: "#34363d",
  card: "#24262c",
  cardShadow: "0 0 0 1px #ffffff14, 0 1px 2px #0000004d, 0 1px 3px #00000066",
  cardShadowHover: "0 0 0 1px #ffffff1f, 0 4px 8px -2px #00000080, 0 2px 4px -2px #00000066",
  cardShadowSelected: "0 0 0 2px #528bff, 0 4px 8px -2px #00000080",
  title: "#f2f4f7",
  glyph: "#ffffff",
  startEnd: "#528bff",
  decision: "#22ccee",
  step: "#8098f9",
  failure: "#f97066",
  failureText: "#fda29b",
  subgraph: "#fdb022",
  subgraphTagBackground: "#4e3510",
  subgraphTagText: "#fec84b",
  edge: "#8287f2",
  pendingTagBackground: "#3a2d0f",
  pendingTagBorder: "#7a5a12",
  pendingTagText: "#fec84b",
  missingDocTagBackground: "#31333a",
  missingDocTagBorder: "#85888e",
  missingDocTagText: "#cecfd2",
  branchLabel: "#85888e",
  conditionBackground: "#31333a",
  conditionText: "#cecfd2",
  neutral: "#61646c",
  skeleton: "#2c2e35",
  muted: "#94969c",
};
