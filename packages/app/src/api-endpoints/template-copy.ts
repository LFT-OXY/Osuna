import type { TFunction } from "i18next";

/*
 * 模板里 daemon 给的英文：区域或套餐名、一句说明、key 框提示、资源地址框下的说明。认得的按界面语言显示（docs/i18n.md 里「按已知名字
 * 匹配一个固定控件」的例外），认不出的照原文；Coding Plan、Step Plan 这类套餐的产品名不翻译，照原文。
 */

const REGION_NAME_KEYS: Readonly<Record<string, string>> = {
  "Pay as you go": "payAsYouGo",
  "Pay as you go · China": "payAsYouGoChina",
  "Pay as you go · Global": "payAsYouGoGlobal",
  "Plan · China": "planChina",
  "Plan · Singapore": "planSingapore",
  "Plan · Europe": "planEurope",
  "Token Plan Personal": "tokenPlanPersonal",
  "Token Plan Enterprise": "tokenPlanEnterprise",
  "Enterprise plan · China": "enterprisePlanChina",
  "Enterprise plan · Global": "enterprisePlanGlobal",
  China: "china",
  Global: "global",
  Auto: "auto",
  "China Mainland": "chinaMainland",
};

const NOTE_KEYS: Readonly<Record<string, string>> = {
  Membership: "membership",
  "Token Plan · pay as you go": "tokenPlanPayAsYouGo",
  "DashScope · intl": "dashScopeIntl",
  "DashScope · China": "dashScopeChina",
  "Qwen AI platform · subscription": "qwenPlatformSubscription",
  "Alibaba Cloud Bailian · subscription": "bailianSubscription",
  "cloud models, with an API key": "cloudModels",
  "Nous Research · Hermes and other models": "nousModels",
  "open coding models, $10/month": "openCodingModels10",
  "open coding models, $9.99/month": "openCodingModels999",
  "free models with no key": "freeModelsNoKey",
  "Bedrock API key": "bedrockApiKey",
  "your resource's endpoint and key": "azureResource",
};

const KEY_HINT_KEYS: Readonly<Record<string, string>> = {
  "optional: free models need no key": "freeModelsNeedNoKey",
};

const ENDPOINT_HINT_KEYS: Readonly<Record<string, string>> = {
  "Your resource's endpoint, from Keys and Endpoint in the Azure portal. Once added, Osuna asks the resource for its deployments with this key, over its v1 API; the deployments' names are the model ids.":
    "azure",
};

export function templateEndpointHint(t: TFunction, hint: string): string {
  const key = ENDPOINT_HINT_KEYS[hint];
  return key ? t(`settings.apiEndpoints.templates.endpointHints.${key}`) : hint;
}

export function templateRegionName(t: TFunction, name: string): string {
  const key = REGION_NAME_KEYS[name];
  return key ? t(`settings.apiEndpoints.templates.regionNames.${key}`) : name;
}

export function templateNote(t: TFunction, note: string): string {
  const key = NOTE_KEYS[note];
  return key ? t(`settings.apiEndpoints.templates.notes.${key}`) : note;
}

export function templateKeyHint(t: TFunction, hint: string): string {
  const key = KEY_HINT_KEYS[hint];
  return key ? t(`settings.apiEndpoints.templates.keyHints.${key}`) : hint;
}

/** 区域还是套餐：daemon 给 region / plan，认不出的当区域。 */
export function templateRegionLabel(t: TFunction, label: string): string {
  return label === "plan"
    ? t("settings.apiEndpoints.templates.plan")
    : t("settings.apiEndpoints.templates.region");
}
