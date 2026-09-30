import type { UsagePricePerMillion } from "@getpaseo/protocol/usage/types";
import { EMPTY_PRICE_DRAFT, buildPriceDraft, type PriceDraft, type PriceField } from "./pricing";

export interface PriceRowError {
  model: string;
  message: string;
  /** 校验没过（而不是 daemon 拒绝）：没填或填错的格子要标出来。 */
  invalid: boolean;
}

/** 「自定义价格」组各行的编辑与写回状态。 */
export interface PriceRowsState {
  drafts: Record<string, PriceDraft>;
  /** 草稿被外部丢弃（取消、保存成功）时变值，把非受控输入框重新播种。 */
  draftToken: number;
  /** 一次只有一行显示错误：它替换那一行的状态行。 */
  error: PriceRowError | null;
  /** 正在写回覆盖表的那一行：保存或移除自定义价格。 */
  writingModel: string | null;
  /**
   * 从 LiteLLM 行点了「自定义」、暂时拉进自定义组的模型。保存后仍留着：daemon 广播
   * 新价格表之前这个模型还是 LiteLLM 价格，从集合里拿掉会让它在两组之间跳一下；
   * 之后它已是自定义价格，留在集合里不改变分组。取消与移除自定义价格时拿掉。
   */
  customizing: ReadonlySet<string>;
}

export type PriceRowsAction =
  | { type: "editOpened"; model: string; price: UsagePricePerMillion | null }
  | { type: "customizeOpened"; model: string; price: UsagePricePerMillion | null }
  | { type: "cancelled"; model: string }
  | { type: "fieldChanged"; model: string; field: PriceField; value: string }
  | { type: "draftRejected"; model: string; message: string }
  | { type: "writeStarted"; model: string }
  | { type: "writeFailed"; model: string; message: string }
  | { type: "saved"; model: string }
  | { type: "removed"; model: string };

export const INITIAL_PRICE_ROWS: PriceRowsState = {
  drafts: {},
  draftToken: 0,
  error: null,
  writingModel: null,
  customizing: new Set(),
};

function withoutModel(set: ReadonlySet<string>, model: string): ReadonlySet<string> {
  if (!set.has(model)) return set;
  const next = new Set(set);
  next.delete(model);
  return next;
}

function dropDraft(drafts: Record<string, PriceDraft>, model: string): Record<string, PriceDraft> {
  const { [model]: _dropped, ...rest } = drafts;
  return rest;
}

export function priceRowsReducer(state: PriceRowsState, action: PriceRowsAction): PriceRowsState {
  switch (action.type) {
    case "editOpened":
      return {
        ...state,
        error: null,
        drafts: { ...state.drafts, [action.model]: buildPriceDraft(action.price) },
      };
    case "customizeOpened":
      return {
        ...priceRowsReducer(state, { ...action, type: "editOpened" }),
        customizing: new Set(state.customizing).add(action.model),
      };
    case "cancelled":
      return {
        ...state,
        error: null,
        draftToken: state.draftToken + 1,
        drafts: dropDraft(state.drafts, action.model),
        customizing: withoutModel(state.customizing, action.model),
      };
    case "fieldChanged": {
      // 无价格数据的行一直开着输入框，没有草稿时从空的四格开始。
      const draft = state.drafts[action.model] ?? EMPTY_PRICE_DRAFT;
      return {
        ...state,
        drafts: { ...state.drafts, [action.model]: { ...draft, [action.field]: action.value } },
      };
    }
    case "draftRejected":
      return { ...state, error: { model: action.model, message: action.message, invalid: true } };
    case "writeStarted":
      return { ...state, error: null, writingModel: action.model };
    case "writeFailed":
      // 草稿留着：用户不必重新输入四列。
      return {
        ...state,
        writingModel: null,
        error: { model: action.model, message: action.message, invalid: false },
      };
    case "saved":
      return {
        ...state,
        writingModel: null,
        draftToken: state.draftToken + 1,
        drafts: dropDraft(state.drafts, action.model),
      };
    case "removed":
      // 行怎么变由 daemon 广播后的价格表决定；别的行正在输入的草稿不能被重新播种。
      return {
        ...state,
        writingModel: null,
        customizing: withoutModel(state.customizing, action.model),
      };
  }
}

/** `locked`：另一行正在写回覆盖表，这一行先不能写。 */
export type RowWriteState = "idle" | "writing" | "locked";

/**
 * 覆盖表整段写回，两行同时写会各自基于同一份旧表，后写的冲掉先写的；所以一行在写时，
 * 其余行的写入都先停用。
 */
export function resolveRowWriteState(writingModel: string | null, model: string): RowWriteState {
  if (writingModel === null) return "idle";
  return writingModel === model ? "writing" : "locked";
}
