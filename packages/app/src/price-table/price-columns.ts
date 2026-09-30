import type { ViewStyle } from "react-native";

/**
 * 表头和数据行是两个组件，列的几何只写在这里，免得两边各写一份然后漂移。
 *
 * 模型列弹性，四个价格列与操作列定宽：价格列等宽，表头、输入框里的数字和只读数值
 * 才能右对齐到同一条线。
 */
export const PRICE_COLUMN_GAP = 8;

const PRICE_WIDTH = 88;
/**
 * 「取消」图标加「保存」，或两个图标按钮。按最长的「保存」算：fr「Enregistrer」约 101，
 * 加 4 的间距和 28 的图标按钮。
 */
const ACTIONS_WIDTH = 136;

/**
 * 价格输入框的左右内边距。只读数值与表头的右内边距 = 它 + 1px 边框，所以三者的
 * 数字落在同一条右边线上。
 */
export const PRICE_INPUT_PADDING_X = 8;
export const PRICE_VALUE_INSET_RIGHT = PRICE_INPUT_PADDING_X + 1;

export const priceColumns = {
  model: { flex: 1, minWidth: 0 },
  price: { width: PRICE_WIDTH },
  actions: { width: ACTIONS_WIDTH },
} satisfies Record<string, ViewStyle>;

/** 行的左右内边距（16×2）加上模型列留给 id 的最小宽度（120）。 */
const TABLE_MIN_CONTENT_WIDTH = 32 + 120 + PRICE_WIDTH * 4 + ACTIONS_WIDTH + PRICE_COLUMN_GAP * 5;

export type PriceTableLayout = "table" | "stacked";

/**
 * 按价格表自己量到的宽度决定排法，而不是窗口：桌面上设置侧栏和应用侧栏会吃掉宽度，
 * 窗口宽于 720 时详情栏仍可能放不下六列。没量到之前按形态先猜。
 */
export function resolvePriceTableLayout(input: {
  contentWidth: number | null;
  isCompact: boolean;
}): PriceTableLayout {
  if (input.isCompact) return "stacked";
  if (input.contentWidth === null) return "table";
  return input.contentWidth >= TABLE_MIN_CONTENT_WIDTH ? "table" : "stacked";
}
