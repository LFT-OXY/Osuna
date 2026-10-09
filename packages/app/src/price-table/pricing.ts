import type {
  UsagePricePerMillion,
  UsagePricingModel,
  UsagePricingOverride,
  UsagePricingTableInfo,
} from "@osuna/protocol/usage/types";
import type { UsageText } from "@/usage/text";

/**
 * 四列的字段名与表头键成对放在一处：表头和单元格分开各列一遍时，重排或改名会让
 * 表头静默地标错列，而没有任何东西会报错。
 */
export const PRICE_COLUMNS = [
  {
    field: "input",
    labelKey: "settings.host.priceTable.columns.input",
    shortLabelKey: "settings.host.priceTable.columns.short.input",
  },
  {
    field: "cachedInput",
    labelKey: "settings.host.priceTable.columns.cacheRead",
    shortLabelKey: "settings.host.priceTable.columns.short.cacheRead",
  },
  {
    field: "cacheWrite",
    labelKey: "settings.host.priceTable.columns.cacheWrite",
    shortLabelKey: "settings.host.priceTable.columns.short.cacheWrite",
  },
  {
    field: "output",
    labelKey: "settings.host.priceTable.columns.output",
    shortLabelKey: "settings.host.priceTable.columns.short.output",
  },
] as const satisfies readonly {
  field: keyof UsagePricePerMillion;
  labelKey: string;
  /** 窄屏把四列压成一行小字时用的短标签，带 `{{price}}` 占位。 */
  shortLabelKey: string;
}[];

export type PriceField = (typeof PRICE_COLUMNS)[number]["field"];

/** 四列价格在编辑时是四个输入框，所以草稿是字符串，不是数字。 */
export interface PriceDraft {
  input: string;
  cachedInput: string;
  cacheWrite: string;
  output: string;
}

export const EMPTY_PRICE_DRAFT: PriceDraft = {
  input: "",
  cachedInput: "",
  cacheWrite: "",
  output: "",
};

/**
 * 表格里的价格是「每百万 token 多少美元」，单位写在卡片副标题上，格子里只有数字。
 * 末尾的零去掉：`3.000000` 读起来像精度，其实只是 toFixed 的补位。
 */
export function formatPriceCell(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "0" ? "<0.000001" : trimmed;
}

/** 空串、负数和非数字都不是价格；0 是价格（免费的模型）。 */
export function parsePriceInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function buildPriceDraft(price: UsagePricePerMillion | null): PriceDraft {
  if (!price) return EMPTY_PRICE_DRAFT;
  return {
    input: formatPriceCell(price.input),
    cachedInput: formatPriceCell(price.cachedInput),
    cacheWrite: formatPriceCell(price.cacheWrite),
    output: formatPriceCell(price.output),
  };
}

/** 四列缺一不可：半张价格表会把一轮里的一部分 token 静默算成 0。 */
export function parsePriceDraft(draft: PriceDraft): UsagePricePerMillion | null {
  const input = parsePriceInput(draft.input);
  const cachedInput = parsePriceInput(draft.cachedInput);
  const cacheWrite = parsePriceInput(draft.cacheWrite);
  const output = parsePriceInput(draft.output);
  if (input == null || cachedInput == null || cacheWrite == null || output == null) return null;
  return { input, cachedInput, cacheWrite, output };
}

/** 覆盖价按模型名匹配：忽略大小写与首尾空格，与 daemon 的匹配规则一致。 */
function modelMatchKey(model: string): string {
  return model.trim().toLowerCase();
}

/**
 * 覆盖表整段写回 daemon 配置，所以这里返回的是完整的新数组。命中就替换价格并
 * 保留原来的备注。
 */
export function upsertPricingOverride(
  overrides: readonly UsagePricingOverride[],
  model: string,
  pricePerMillion: UsagePricePerMillion,
): UsagePricingOverride[] {
  const target = modelMatchKey(model);
  let replaced = false;
  const next = overrides.map((override) => {
    if (modelMatchKey(override.model) !== target) return override;
    replaced = true;
    return { ...override, pricePerMillion };
  });
  return replaced ? next : [...next, { model, pricePerMillion }];
}

/**
 * 「移除自定义价格」：删掉该模型的覆盖项，匹配规则与 `upsertPricingOverride` 相同。
 * 同名的每一条都删——daemon 取最后一条，只删一条会让剩下的那条接着生效。
 */
export function removePricingOverride(
  overrides: readonly UsagePricingOverride[],
  model: string,
): UsagePricingOverride[] {
  const target = modelMatchKey(model);
  return overrides.filter((override) => modelMatchKey(override.model) !== target);
}

/**
 * 一个模型一行。`usage.pricing.list` 按 (模型, CLI, 后端) 返回，同一个模型被两家
 * CLI 用过就会出现多条；而覆盖价是按模型名匹配的，多行编辑的其实是同一条覆盖价，
 * 还会撞 React key 与 testID。保留先出现的那条：daemon 已经把无价格的排在前面、
 * 其余按最近使用排序。
 */
export function dedupePricingModels(models: readonly UsagePricingModel[]): UsagePricingModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = modelMatchKey(model.model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * daemon 拒绝一次写入时给的原因。`DaemonRpcError` 把 `requestType=` / `code=`
 * 拼进了 `message`，那是日志内容；剥掉之后剩下的才是能给用户看的一句话。完整的
 * message 仍然进 console，两者分开。
 */
export function extractFailureReason(cause: unknown): string {
  if (!(cause instanceof Error)) return "";
  return cause.message.split(/ (?:requestType|code)=/)[0]?.trim() ?? "";
}

/**
 * 单复数用两个键、由这里选键，而不是 i18next 的 `_one` / `_other` 后缀：后缀形式
 * 在 ru / ar 下会回落成英文，资源测试拦不住。
 */
export function describeModelCount(count: number): UsageText {
  return count === 1
    ? { key: "settings.host.priceTable.modelCountOne" }
    : { key: "settings.host.priceTable.modelCountMany", params: { count } };
}

export interface PricingModelGroups {
  /** 无价格数据与已自定义的模型，加上正在从 LiteLLM 行自定义的模型。 */
  custom: UsagePricingModel[];
  litellm: UsagePricingModel[];
}

/**
 * 价格表的两组。只能按当前来源分：设了自定义价格后 daemon 不再告诉客户端 LiteLLM
 * 是否也有价格。无价格数据的排在已自定义的前面（那是用户来这一页要填的），组内
 * 保持 daemon 的顺序。`customizing` 是从 LiteLLM 行点「自定义」后暂时拉进上面一组的
 * 模型，只是界面状态。
 */
export function groupPricingModels(
  models: readonly UsagePricingModel[],
  customizing: ReadonlySet<string>,
): PricingModelGroups {
  const unpriced: UsagePricingModel[] = [];
  const custom: UsagePricingModel[] = [];
  const litellm: UsagePricingModel[] = [];
  for (const model of models) {
    if (model.priceSource === null) unpriced.push(model);
    else if (model.priceSource === "override" || customizing.has(model.model)) custom.push(model);
    else litellm.push(model);
  }
  return { custom: [...unpriced, ...custom], litellm };
}

/** LiteLLM 组的搜索：模型 id 子串匹配，不区分大小写。 */
export function filterPricingModels(
  models: readonly UsagePricingModel[],
  query: string,
): readonly UsagePricingModel[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return models;
  return models.filter((model) => model.model.toLowerCase().includes(needle));
}

export function countUnpricedModels(models: readonly UsagePricingModel[]): number {
  return models.filter((model) => model.priceSource === null).length;
}

/**
 * 快照与联网更新各是一整句，而不是往一句里插来源名词：来源的性数会牵动后面的
 * 「更新」（es「Instantánea … actualizada」与「Precios … actualizados」）。
 */
export function describeLiteLLMSubtitle(input: {
  source: UsagePricingTableInfo["source"];
  fetchedAgo: UsageText | null;
}): UsageText {
  return {
    key: `settings.host.priceTable.litellmGroup.subtitle.${input.source}`,
    // 协议保证 `fetchedAt` 非空，所以描述不出来只可能是时间戳不可解析。那正是
    // 不该替 daemon 断言「刚刚更新」的场合，留一个破折号。
    params: { ago: input.fetchedAgo ?? { text: "—" } },
  };
}

/** LiteLLM 组折叠时唯一的那一行。 */
export function describeLiteLLMSummary(count: number): UsageText {
  return {
    key: "settings.host.priceTable.litellmGroup.summary",
    params: { models: describeModelCount(count) },
  };
}
