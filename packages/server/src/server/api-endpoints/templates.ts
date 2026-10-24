// 模板清单照 magpie（https://github.com/yetone/magpie，internal/provider/presets.go，7597c132）；Bedrock 与 Azure 的认证头、
// 每个模型走哪种格式、Azure 地址与部署名照 authheader.go 的 AuthHeaders、account.go 的 Bedrock 一段、azure.go。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointBaseUrl,
  ApiEndpointRequestFormat,
  ApiEndpointTemplate,
  ApiEndpointTemplateRegion,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { KeyHeaders } from "./gateway/refusals.js";

/*
 * 内置模板（Template）：随 daemon 版本走，不联网下载，经 list_templates 发给客户端。
 * 收录 magpie 的 57 个里去掉 5 个决策模型、Remote magpie、Google Vertex AI 之后的；Google Gemini 等子任务 7。
 * 顺序即列表里的顺序。
 * 国际站与中国站各是一个模板，中国站的 id 是国际站的加 `-cn`（照 magpie），客户端合成一行。
 */

interface FormatUrls {
  anthropic?: string;
  chat?: string;
  responses?: string;
}

// 按 API_ENDPOINT_REQUEST_FORMATS 的顺序排，和存下来的接口一样。
function urls({ anthropic, chat, responses }: FormatUrls): ApiEndpointBaseUrl[] {
  return [
    ...(anthropic ? [{ format: "anthropic_messages", url: anthropic }] : []),
    ...(chat ? [{ format: "openai_chat", url: chat }] : []),
    ...(responses ? [{ format: "openai_responses", url: responses }] : []),
  ];
}

type RegionInput = Omit<ApiEndpointTemplateRegion, "baseUrls"> & FormatUrls;

function region({ anthropic, chat, responses, ...rest }: RegionInput): ApiEndpointTemplateRegion {
  return { ...rest, baseUrls: urls({ anthropic, chat, responses }) };
}

type TemplateInput = Omit<ApiEndpointTemplate, "baseUrls" | "modelsDevIds"> &
  FormatUrls & { modelsDevIds?: string[] };

function template({
  anthropic,
  chat,
  responses,
  modelsDevIds,
  ...rest
}: TemplateInput): ApiEndpointTemplate {
  return {
    ...rest,
    baseUrls: urls({ anthropic, chat, responses }),
    modelsDevIds: modelsDevIds ?? [],
  };
}

// 阿里的 Token Plan 在千问 AI 平台与百炼上各卖一份，文本模型相同（magpie alibabaPlanModels）。
const ALIBABA_PLAN_MODELS = [
  "auto",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-flash",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "deepseek-v4-pro-0813",
  "deepseek-v4-flash-0731",
  "glm-5.3",
  "glm-5.2",
];

const VOLCENGINE_PLAN_MODELS = [
  "ark-code-latest",
  "doubao-seed-evolving",
  "doubao-seed-2.1-pro",
  "doubao-seed-2.1-lite",
  "doubao-seed-2.1-turbo",
  "doubao-seed-2.0-mini",
  "minimax-m3",
  "glm-5.3",
  "glm-5.3-flash",
  "deepseek-v4.1-flash",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "kimi-k2.7-code",
  "kimi-k2.8-preview",
  "kimi-k3",
];

export const BEDROCK_TEMPLATE_ID = "bedrock";
export const AZURE_TEMPLATE_ID = "azure";

// 按 AWS 控制台与 key 所在区域的写法，用区域代码命名。
const BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "eu-central-1",
  "eu-west-1",
  "eu-west-3",
  "ap-northeast-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-south-1",
];

function bedrockUrls(regionId: string): FormatUrls {
  const runtime = `https://bedrock-runtime.${regionId}.amazonaws.com`;
  return {
    anthropic: `${runtime}/anthropic`,
    chat: `${runtime}/openai/v1`,
    responses: `${runtime}/openai/v1`,
  };
}

const VENDORS: ApiEndpointTemplate[] = [
  template({
    id: "anthropic",
    name: "Anthropic",
    group: "vendor",
    modelsDevIds: ["anthropic"],
    anthropic: "https://api.anthropic.com",
    website: "https://console.anthropic.com",
    keysUrl: "https://console.anthropic.com/settings/keys",
    // 一把 key 能用几个 workspace 时，用它指明这次请求是哪一个。
    headerHints: ["anthropic-workspace-id"],
  }),
  template({
    id: "openai",
    name: "OpenAI",
    group: "vendor",
    modelsDevIds: ["openai"],
    chat: "https://api.openai.com/v1",
    responses: "https://api.openai.com/v1",
    website: "https://platform.openai.com",
    keysUrl: "https://platform.openai.com/api-keys",
  }),
  template({
    id: "deepseek",
    name: "DeepSeek",
    group: "vendor",
    modelsDevIds: ["deepseek"],
    chat: "https://api.deepseek.com/v1",
    responses: "https://api.deepseek.com/v1",
    anthropic: "https://api.deepseek.com/anthropic",
    website: "https://platform.deepseek.com",
    keysUrl: "https://platform.deepseek.com/api_keys",
  }),
  template({
    id: "xai",
    name: "xAI",
    group: "vendor",
    modelsDevIds: ["xai"],
    chat: "https://api.x.ai/v1",
    responses: "https://api.x.ai/v1",
    anthropic: "https://api.x.ai",
    website: "https://console.x.ai",
    keysUrl: "https://console.x.ai",
  }),
  template({
    id: "moonshot",
    name: "Kimi",
    group: "vendor",
    modelsDevIds: ["moonshotai"],
    chat: "https://api.moonshot.ai/v1",
    anthropic: "https://api.moonshot.ai/anthropic",
    website: "https://platform.moonshot.ai",
    keysUrl: "https://platform.moonshot.ai/console/api-keys",
  }),
  template({
    id: "moonshot-cn",
    name: "Kimi (China)",
    group: "vendor",
    modelsDevIds: ["moonshotai"],
    chat: "https://api.moonshot.cn/v1",
    anthropic: "https://api.moonshot.cn/anthropic",
    website: "https://platform.moonshot.cn",
    keysUrl: "https://platform.moonshot.cn/console/api-keys",
  }),
  // Kimi Code 会员自己的地址：会员可在第三方工具里用，key 在它的控制台建。
  template({
    id: "kimi-code",
    name: "Kimi Code",
    group: "vendor",
    modelsDevIds: ["kimi-code-plan-global"],
    chat: "https://api.kimi.ai/coding/v1",
    anthropic: "https://api.kimi.ai/coding",
    note: "Membership",
    website: "https://www.kimi.com/code",
    keysUrl: "https://www.kimi.com/code/console",
  }),
  template({
    id: "kimi-code-cn",
    name: "Kimi Code (China)",
    group: "vendor",
    modelsDevIds: ["kimi-code-plan-cn"],
    chat: "https://api.kimi.com/coding/v1",
    anthropic: "https://api.kimi.com/coding",
    note: "Membership",
    website: "https://www.kimi.com/code",
    keysUrl: "https://www.kimi.com/code/console",
  }),
  // GLM Coding Plan 有自己的 OpenAI 地址：套餐的 key 发到按量付费的地址会被说没余额。
  template({
    id: "zhipu",
    name: "Zhipu GLM",
    group: "vendor",
    modelsDevIds: ["zhipuai"],
    chat: "https://open.bigmodel.cn/api/paas/v4",
    anthropic: "https://open.bigmodel.cn/api/anthropic",
    website: "https://open.bigmodel.cn",
    keysUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    regionLabel: "plan",
    regions: [
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://open.bigmodel.cn/api/paas/v4",
        anthropic: "https://open.bigmodel.cn/api/anthropic",
      }),
      region({
        id: "coding",
        name: "Coding Plan",
        chat: "https://open.bigmodel.cn/api/coding/paas/v4",
        responses: "https://open.bigmodel.cn/api/v1",
        anthropic: "https://open.bigmodel.cn/api/anthropic",
      }),
    ],
  }),
  template({
    id: "zai",
    name: "Z.ai",
    group: "vendor",
    modelsDevIds: ["zhipuai"],
    chat: "https://api.z.ai/api/paas/v4",
    anthropic: "https://api.z.ai/api/anthropic",
    website: "https://z.ai",
    keysUrl: "https://z.ai/manage-apikey/apikey-list",
    regionLabel: "plan",
    regions: [
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://api.z.ai/api/paas/v4",
        anthropic: "https://api.z.ai/api/anthropic",
      }),
      region({
        id: "coding",
        name: "Coding Plan",
        chat: "https://api.z.ai/api/coding/paas/v4",
        responses: "https://api.z.ai/api/v1",
        anthropic: "https://api.z.ai/api/anthropic",
      }),
    ],
  }),
  template({
    id: "minimax",
    name: "MiniMax",
    group: "vendor",
    modelsDevIds: ["minimax"],
    chat: "https://api.minimax.io/v1",
    anthropic: "https://api.minimax.io/anthropic",
    website: "https://platform.minimax.io",
    keysUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
  }),
  template({
    id: "minimax-cn",
    name: "MiniMax (China)",
    group: "vendor",
    modelsDevIds: ["minimax"],
    chat: "https://api.minimaxi.com/v1",
    anthropic: "https://api.minimaxi.com/anthropic",
    website: "https://platform.minimaxi.com",
    keysUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  }),
  // Step Plan 有自己的地址（step_plan/…），它的 key 在按量付费的地址上被拒。
  template({
    id: "stepfun",
    name: "StepFun",
    group: "vendor",
    modelsDevIds: ["stepfun-ai-step-plan", "stepfun-ai"],
    chat: "https://api.stepfun.ai/step_plan/v1",
    anthropic: "https://api.stepfun.ai/step_plan",
    website: "https://platform.stepfun.ai",
    keysUrl: "https://platform.stepfun.ai/interface-key",
    regionLabel: "plan",
    regions: [
      region({
        id: "plan",
        name: "Step Plan",
        chat: "https://api.stepfun.ai/step_plan/v1",
        anthropic: "https://api.stepfun.ai/step_plan",
      }),
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://api.stepfun.ai/v1",
        anthropic: "https://api.stepfun.ai",
      }),
    ],
  }),
  template({
    id: "stepfun-cn",
    name: "StepFun (China)",
    group: "vendor",
    modelsDevIds: ["stepfun-step-plan", "stepfun"],
    chat: "https://api.stepfun.com/step_plan/v1",
    anthropic: "https://api.stepfun.com/step_plan",
    website: "https://platform.stepfun.com",
    keysUrl: "https://platform.stepfun.com/interface-key",
    regionLabel: "plan",
    regions: [
      region({
        id: "plan",
        name: "Step Plan",
        chat: "https://api.stepfun.com/step_plan/v1",
        anthropic: "https://api.stepfun.com/step_plan",
      }),
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://api.stepfun.com/v1",
        anthropic: "https://api.stepfun.com",
      }),
    ],
  }),
  // 小米 MiMo：Token Plan 的 tp- key 只在所在区域自己的主机上用，按量付费在 api.xiaomimimo.com。
  template({
    id: "xiaomi",
    name: "Xiaomi MiMo",
    group: "vendor",
    modelsDevIds: ["xiaomi-token-plan-cn", "xiaomi"],
    chat: "https://token-plan-cn.xiaomimimo.com/v1",
    responses: "https://token-plan-cn.xiaomimimo.com/v1",
    anthropic: "https://token-plan-cn.xiaomimimo.com/anthropic",
    note: "Token Plan · pay as you go",
    website: "https://platform.xiaomimimo.com",
    keysUrl: "https://platform.xiaomimimo.com/token-plan",
    regions: [
      region({
        id: "plan-cn",
        name: "Plan · China",
        chat: "https://token-plan-cn.xiaomimimo.com/v1",
        responses: "https://token-plan-cn.xiaomimimo.com/v1",
        anthropic: "https://token-plan-cn.xiaomimimo.com/anthropic",
        modelsDevIds: ["xiaomi-token-plan-cn", "xiaomi"],
      }),
      region({
        id: "plan-sgp",
        name: "Plan · Singapore",
        chat: "https://token-plan-sgp.xiaomimimo.com/v1",
        responses: "https://token-plan-sgp.xiaomimimo.com/v1",
        anthropic: "https://token-plan-sgp.xiaomimimo.com/anthropic",
        modelsDevIds: ["xiaomi-token-plan-sgp", "xiaomi"],
      }),
      region({
        id: "plan-ams",
        name: "Plan · Europe",
        chat: "https://token-plan-ams.xiaomimimo.com/v1",
        responses: "https://token-plan-ams.xiaomimimo.com/v1",
        anthropic: "https://token-plan-ams.xiaomimimo.com/anthropic",
        modelsDevIds: ["xiaomi-token-plan-ams", "xiaomi"],
      }),
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://api.xiaomimimo.com/v1",
        responses: "https://api.xiaomimimo.com/v1",
        anthropic: "https://api.xiaomimimo.com/anthropic",
        modelsDevIds: ["xiaomi"],
      }),
    ],
  }),
  // 百度千帆：个人版、企业版 Token Plan 各有自己的地址，都不给清单；按量付费在 v2 根上，给清单。
  template({
    id: "baidu-qianfan",
    name: "Baidu Qianfan",
    group: "vendor",
    chat: "https://qianfan.baidubce.com/v2/tokenplan/personal",
    responses: "https://qianfan.baidubce.com/v2/tokenplan/personal",
    anthropic: "https://qianfan.baidubce.com/anthropic/tokenplan/personal",
    note: "Token Plan · pay as you go",
    website: "https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6",
    keysUrl: "https://console.bce.baidu.com/qianfan/resource/token-plan",
    regionLabel: "plan",
    regions: [
      region({
        id: "personal",
        name: "Token Plan Personal",
        chat: "https://qianfan.baidubce.com/v2/tokenplan/personal",
        responses: "https://qianfan.baidubce.com/v2/tokenplan/personal",
        anthropic: "https://qianfan.baidubce.com/anthropic/tokenplan/personal",
      }),
      region({
        id: "team",
        name: "Token Plan Enterprise",
        chat: "https://qianfan.baidubce.com/v2/tokenplan/team",
        responses: "https://qianfan.baidubce.com/v2/tokenplan/team",
        anthropic: "https://qianfan.baidubce.com/anthropic/tokenplan/team",
      }),
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://qianfan.baidubce.com/v2",
        responses: "https://qianfan.baidubce.com/v2",
        anthropic: "https://qianfan.baidubce.com/anthropic",
        listsModels: true,
        keysUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
      }),
    ],
    noModelList: true,
    models: [
      "qianfan-code-latest",
      "deepseek-v4.1-flash",
      "deepseek-v4-pro",
      "deepseek-v4-pro-0813",
      "deepseek-v4-flash",
      "deepseek-v4-flash-0731",
      "deepseek-v3.2",
      "glm-5.3",
      "glm-5.3-flash",
      "glm-5.2",
      "glm-5.1",
      "glm-5",
    ],
  }),
  // 腾讯云：Token Plan、TokenHub 按量付费（广州、新加坡）与企业版 Token Plan，在一个模板里切换。
  template({
    id: "tencent-cloud",
    name: "Tencent Cloud",
    group: "vendor",
    chat: "https://api.lkeap.cloud.tencent.com/plan/v3",
    anthropic: "https://api.lkeap.cloud.tencent.com/plan/anthropic",
    note: "Token Plan · pay as you go",
    website: "https://cloud.tencent.com/document/product/1823/130060",
    keysUrl: "https://console.cloud.tencent.com/tokenhub/tokenplan",
    regions: [
      region({
        id: "plan",
        name: "Plan · China",
        chat: "https://api.lkeap.cloud.tencent.com/plan/v3",
        anthropic: "https://api.lkeap.cloud.tencent.com/plan/anthropic",
        website: "https://cloud.tencent.com/document/product/1823/130060",
        keysUrl: "https://console.cloud.tencent.com/tokenhub/tokenplan",
        models: [
          "tc-code-latest",
          "glm-5.3",
          "glm-5.3-flash",
          "glm-5.2",
          "glm-5.1",
          "glm-5",
          "kimi-k3",
          "kimi-k2.7-code",
          "deepseek-v4-pro-202606",
          "deepseek-v4-flash-202605",
          "minimax-m3",
          "minimax-m2.7",
          "hy4-preview",
          "hy3",
        ],
      }),
      region({
        id: "cn",
        name: "Pay as you go · China",
        chat: "https://tokenhub.tencentmaas.com/v1",
        responses: "https://tokenhub.tencentmaas.com/v1",
        anthropic: "https://tokenhub.tencentmaas.com",
        website: "https://cloud.tencent.com/document/product/1823/130078",
        keysUrl: "https://console.cloud.tencent.com/tokenhub/apikey",
        modelsDevIds: ["tencent-tokenhub"],
      }),
      region({
        id: "intl",
        name: "Pay as you go · Global",
        chat: "https://tokenhub-intl.tencentmaas.com/v1",
        responses: "https://tokenhub-intl.tencentmaas.com/v1",
        anthropic: "https://tokenhub-intl.tencentmaas.com",
        website: "https://www.tencentcloud.com/document/product/1300/78939",
        keysUrl: "https://console.tencentcloud.com/tokenhub/apikey",
        modelsDevIds: ["tencent-tokenhub"],
      }),
      region({
        id: "enterprise",
        name: "Enterprise plan · China",
        chat: "https://tokenhub.tencentmaas.com/plan/v3",
        responses: "https://tokenhub.tencentmaas.com/plan/v3",
        anthropic: "https://tokenhub.tencentmaas.com/plan/anthropic",
        website: "https://cloud.tencent.com/document/product/1823/130659",
        keysUrl: "https://console.cloud.tencent.com/tokenhub/tokenplan",
        models: [
          "auto",
          "hy4-preview",
          "glm-5.3",
          "glm-5.3-flash",
          "glm-5.2",
          "kimi-k3",
          "kimi-k2.7-code",
          "kimi-k2.7-code-highspeed",
          "kimi-k2.6",
          "minimax-m3",
          "minimax-m2.7",
          "deepseek-v4.1-flash",
          "deepseek-v4-pro",
          "deepseek-v4-pro-0813",
          "deepseek-v4-flash-0731",
          "deepseek-v4-pro-202606",
          "deepseek-v4-flash-202605",
          "mimo-v2.6-pro",
          "mimo-v2.6-flash",
        ],
      }),
      region({
        id: "enterprise-intl",
        name: "Enterprise plan · Global",
        chat: "https://tokenhub-intl.tencentmaas.com/plan/v3",
        responses: "https://tokenhub-intl.tencentmaas.com/plan/v3",
        anthropic: "https://tokenhub-intl.tencentmaas.com/plan/anthropic",
        website: "https://cloud.tencent.com/document/product/1823/130659",
        keysUrl: "https://console.tencentcloud.com/tokenhub/tokenplan",
        models: [
          "auto",
          "hy4-preview",
          "glm-5.3",
          "glm-5.3-flash",
          "glm-5.2",
          "kimi-k3",
          "kimi-k2.7-code",
          "kimi-k2.7-code-highspeed",
          "minimax-m3",
          "deepseek-v4.1-flash",
          "deepseek-v4-pro",
          "deepseek-v4-pro-0813",
          "deepseek-v4-flash-0731",
          "deepseek-v4-pro-202606",
          "deepseek-v4-flash-202605",
          "mimo-v2.6-pro",
          "mimo-v2.6-flash",
        ],
      }),
    ],
  }),
  // 华为云 MaaS 的 Token Plan：额度只在套餐自己的 /plan 地址上用，没有 Responses。
  template({
    id: "huaweicloud",
    name: "Huawei Cloud MaaS",
    shortName: "Huawei Cloud",
    group: "vendor",
    chat: "https://api.modelarts-maas.com/plan/v2",
    anthropic: "https://api.modelarts-maas.com/plan/anthropic",
    note: "Token Plan · 西南-贵阳一",
    website: "https://support.huaweicloud.com/Token-plan-maas/tokenplan-maas-0001.html",
    keysUrl: "https://console.huaweicloud.com/modelarts/?#/model-studio/authmanage",
    regionLabel: "plan",
    regions: [
      region({
        id: "plan",
        name: "Token Plan",
        chat: "https://api.modelarts-maas.com/plan/v2",
        anthropic: "https://api.modelarts-maas.com/plan/anthropic",
      }),
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://api.modelarts-maas.com/openai/v1",
        anthropic: "https://api.modelarts-maas.com/anthropic",
      }),
    ],
    models: ["glm-5.3", "glm-5.1", "kimi-k2.6", "deepseek-v4.1-flash", "deepseek-v4-flash"],
  }),
  // 火山方舟：Coding Plan、Agent Plan 各有自己的地址与 key，只有按量付费的 /models 可问。
  template({
    id: "volcengine",
    name: "Volcengine Ark",
    group: "vendor",
    chat: "https://ark.cn-beijing.volces.com/api/coding/v3",
    responses: "https://ark.cn-beijing.volces.com/api/coding/v3",
    anthropic: "https://ark.cn-beijing.volces.com/api/coding",
    note: "火山方舟 · Coding / Agent Plan",
    website: "https://www.volcengine.com/docs/82379/1925114",
    keysUrl: "https://ark.volcengine.com/region:cn-beijing/apikey",
    regionLabel: "plan",
    regions: [
      region({
        id: "coding",
        name: "Coding Plan",
        chat: "https://ark.cn-beijing.volces.com/api/coding/v3",
        responses: "https://ark.cn-beijing.volces.com/api/coding/v3",
        anthropic: "https://ark.cn-beijing.volces.com/api/coding",
        models: VOLCENGINE_PLAN_MODELS,
      }),
      region({
        id: "agent",
        name: "Agent Plan",
        chat: "https://ark.cn-beijing.volces.com/api/plan/v3",
        responses: "https://ark.cn-beijing.volces.com/api/plan/v3",
        anthropic: "https://ark.cn-beijing.volces.com/api/plan",
        models: VOLCENGINE_PLAN_MODELS,
      }),
      region({
        id: "api",
        name: "Pay as you go",
        chat: "https://ark.cn-beijing.volces.com/api/v3",
        responses: "https://ark.cn-beijing.volces.com/api/v3",
        listsModels: true,
      }),
    ],
    noModelList: true,
  }),
  template({
    id: "qwen",
    name: "Qwen",
    group: "vendor",
    modelsDevIds: ["alibaba"],
    chat: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    anthropic: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    note: "DashScope · intl",
    website: "https://modelstudio.console.alibabacloud.com",
    keysUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
  }),
  template({
    id: "qwen-cn",
    name: "Qwen (China)",
    group: "vendor",
    modelsDevIds: ["alibaba"],
    chat: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    anthropic: "https://dashscope.aliyuncs.com/apps/anthropic",
    note: "DashScope · China",
    website: "https://bailian.console.aliyun.com",
    keysUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
  }),
  template({
    id: "qwen-token-plan",
    name: "Qwen Token Plan",
    shortName: "Qwen Plan",
    group: "vendor",
    chat: "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
    anthropic: "https://token-plan.maas.qianwenaiapi.com/apps/anthropic",
    note: "Qwen AI platform · subscription",
    website: "https://platform.qianwenai.com/docs/token-plan/overview",
    keysUrl: "https://platform.qianwenai.com/home/analytics/token-plan/individual",
    models: ALIBABA_PLAN_MODELS,
  }),
  template({
    id: "bailian-token-plan",
    name: "Bailian Token Plan",
    shortName: "Bailian Plan",
    group: "vendor",
    chat: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    anthropic: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    note: "Alibaba Cloud Bailian · subscription",
    website: "https://help.aliyun.com/zh/model-studio/token-plan-overview",
    keysUrl: "https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal",
    models: ALIBABA_PLAN_MODELS,
  }),
  template({
    id: "mistral",
    name: "Mistral",
    group: "vendor",
    modelsDevIds: ["mistral"],
    chat: "https://api.mistral.ai/v1",
    website: "https://console.mistral.ai",
    keysUrl: "https://console.mistral.ai/api-keys",
  }),
  template({
    id: "groq",
    name: "Groq",
    group: "vendor",
    modelsDevIds: ["groq"],
    chat: "https://api.groq.com/openai/v1",
    responses: "https://api.groq.com/openai/v1",
    website: "https://console.groq.com",
    keysUrl: "https://console.groq.com/keys",
  }),
  // Amazon Bedrock，用 Bedrock API key（AWS_BEARER_TOKEN_BEDROCK），不做 SigV4：所选区域的 runtime 在 /anthropic 上给 Claude，
  // 在 /openai/v1 上给其余模型的 Chat，OpenAI 的 GPT（不含 gpt-oss）还有 Responses。没有清单接口，模型是内置的：
  // Claude 与 GPT-6 用各商业区域都转的 global. 推理配置，其余用区域内 id（不是每个区域都有）；限在某地理区（us.、eu.……）的手填。
  template({
    id: BEDROCK_TEMPLATE_ID,
    name: "Amazon Bedrock",
    group: "vendor",
    ...bedrockUrls("us-east-1"),
    note: "Bedrock API key",
    keyHint: "Paste the key",
    website: "https://aws.amazon.com/bedrock/",
    keysUrl: "https://console.aws.amazon.com/bedrock/home#/api-keys",
    regions: BEDROCK_REGIONS.map((id) => region({ id, name: id, ...bedrockUrls(id) })),
    noModelList: true,
    models: [
      "global.anthropic.claude-opus-5-5",
      "global.anthropic.claude-sonnet-5-5",
      "global.anthropic.claude-sonnet-5",
      "global.anthropic.claude-opus-5",
      "global.anthropic.claude-fable-5-1",
      "global.anthropic.claude-opus-4-8",
      "global.anthropic.claude-opus-4-7",
      "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      "global.openai.gpt-6-astra",
      "global.openai.gpt-6-sol",
      "global.openai.gpt-6-luna",
      "openai.gpt-oss-120b-1:0",
      "openai.gpt-oss-20b-1:0",
      "qwen.qwen3-coder-480b-a35b-v1:0",
      "deepseek.v3.2",
      "moonshotai.kimi-k2.5",
      "zai.glm-5",
      "minimax.minimax-m2.5",
    ],
  }),
  // Azure OpenAI，在用户自己的资源上：没有自己的地址，表单要资源的地址，保存时放到它的 v1 API（/openai/v1）上；
  // key 放 api-key，部署名就是模型 id。它也托管别家的模型（Kimi、DeepSeek、Grok……）。
  template({
    id: AZURE_TEMPLATE_ID,
    name: "Azure OpenAI",
    group: "vendor",
    modelsDevIds: ["azure", "openai"],
    note: "your resource's endpoint and key",
    keyHint: "Paste the key",
    endpointExample: "https://<resource>.openai.azure.com",
    endpointHint:
      "Your resource's endpoint, from Keys and Endpoint in the Azure portal. Once added, Osuna asks the resource for its deployments with this key, over its v1 API; the deployments' names are the model ids.",
    website: "https://ai.azure.com",
    keysUrl:
      "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI",
  }),
  // Ollama 自己托管的模型：本机服务的 API，在 ollama.com 上用 key。
  template({
    id: "ollama-cloud",
    name: "Ollama Cloud",
    group: "vendor",
    modelsDevIds: ["ollama-cloud"],
    chat: "https://ollama.com/v1",
    anthropic: "https://ollama.com",
    note: "cloud models, with an API key",
    website: "https://docs.ollama.com/cloud",
    keysUrl: "https://ollama.com/settings/keys",
  }),
  // Nous Portal：Hermes 与别家的模型，Chat 格式，模型名是「厂商/模型」。
  template({
    id: "nous",
    name: "Nous Portal",
    group: "vendor",
    chat: "https://inference-api.nousresearch.com/v1",
    note: "Nous Research · Hermes and other models",
    website: "https://portal.nousresearch.com",
    keysUrl: "https://portal.nousresearch.com",
  }),
];

const RELAYS: ApiEndpointTemplate[] = [
  template({
    id: "openrouter",
    name: "OpenRouter",
    group: "relay",
    modelsDevIds: ["openrouter"],
    chat: "https://openrouter.ai/api/v1",
    anthropic: "https://openrouter.ai/api",
    website: "https://openrouter.ai",
    keysUrl: "https://openrouter.ai/keys",
    // OpenRouter 排行与统计用的应用署名。
    headerHints: ["HTTP-Referer", "X-OpenRouter-Title"],
  }),
  template({
    id: "opencode-go",
    name: "OpenCode Go",
    group: "relay",
    modelsDevIds: ["opencode-go"],
    chat: "https://opencode.ai/zen/go/v1",
    responses: "https://opencode.ai/zen/go/v1",
    anthropic: "https://opencode.ai/zen/go",
    note: "open coding models, $10/month",
    website: "https://opencode.ai/docs/go",
    keysUrl: "https://opencode.ai/auth",
  }),
  // Cline 的开放模型套餐：Cline API 只列它的付费模型，套餐的模型以 cline-pass/ 开头。
  template({
    id: "clinepass",
    name: "ClinePass",
    group: "relay",
    chat: "https://api.cline.bot/api/v1",
    note: "open coding models, $9.99/month",
    website: "https://docs.cline.bot/getting-started/clinepass",
    keysUrl: "https://app.cline.bot",
    modelIdPrefix: "cline-pass/",
    models: [
      "cline-pass/glm-5.3",
      "cline-pass/glm-5.3-flash",
      "cline-pass/kimi-k3",
      "cline-pass/deepseek-v4-pro",
      "cline-pass/deepseek-v4.1-flash",
      "cline-pass/mimo-v2.5",
      "cline-pass/mimo-v2.5-pro",
      "cline-pass/minimax-m3",
      "cline-pass/muse-spark-1.3-contributor",
      "cline-pass/qwen3.8-max",
      "cline-pass/qwen3.7-max",
      "cline-pass/qwen3.7-plus",
    ],
  }),
  template({
    id: "opencode-zen",
    name: "OpenCode Zen",
    group: "relay",
    modelsDevIds: ["opencode"],
    keyOptional: true,
    keyHint: "optional: free models need no key",
    chat: "https://opencode.ai/zen/v1",
    responses: "https://opencode.ai/zen/v1",
    anthropic: "https://opencode.ai/zen",
    website: "https://opencode.ai/docs/zen",
    keysUrl: "https://opencode.ai/auth",
  }),
  // Kilo Code 的网关：免费模型不要 key，Kilo 的 key 能用其余的。
  template({
    id: "kilo",
    name: "Kilo Gateway",
    group: "relay",
    keyOptional: true,
    chat: "https://api.kilo.ai/api/openrouter",
    note: "free models with no key",
    keyHint: "optional: free models need no key",
    website: "https://kilo.ai/docs/gateway",
    keysUrl: "https://app.kilo.ai",
  }),
  // Command Code 的 Provider API：Claude 模型只走 /messages，其余走 Chat 与 Responses。
  template({
    id: "commandcode",
    name: "Command Code",
    group: "relay",
    chat: "https://api.commandcode.ai/provider/v1",
    responses: "https://api.commandcode.ai/provider/v1",
    anthropic: "https://api.commandcode.ai/provider",
    website: "https://commandcode.ai/docs/provider",
    keysUrl: "https://commandcode.ai/settings/keys",
  }),
  template({
    id: "together",
    name: "Together AI",
    group: "relay",
    modelsDevIds: ["togetherai"],
    chat: "https://api.together.xyz/v1",
    website: "https://api.together.ai",
    keysUrl: "https://api.together.ai/settings/api-keys",
  }),
  template({
    id: "fireworks",
    name: "Fireworks",
    group: "relay",
    modelsDevIds: ["fireworks-ai"],
    chat: "https://api.fireworks.ai/inference/v1",
    website: "https://fireworks.ai",
    keysUrl: "https://app.fireworks.ai/settings/users/api-keys",
  }),
  // 国际站是另一个账号，key 和余额（美元）都是另一份。
  template({
    id: "siliconflow",
    name: "SiliconFlow",
    group: "relay",
    modelsDevIds: ["siliconflow"],
    chat: "https://api.siliconflow.cn/v1",
    website: "https://cloud.siliconflow.cn",
    keysUrl: "https://cloud.siliconflow.cn/account/ak",
    regions: [
      region({ id: "cn", name: "China", chat: "https://api.siliconflow.cn/v1" }),
      region({
        id: "intl",
        name: "Global",
        chat: "https://api.siliconflow.com/v1",
        website: "https://cloud.siliconflow.com",
        keysUrl: "https://cloud.siliconflow.com/account/ak",
      }),
    ],
  }),
  // NVIDIA 托管的 NIM：只有 Chat；它的 /v1/responses 只对少数模型有用。
  template({
    id: "nvidia",
    name: "NVIDIA NIM",
    group: "relay",
    modelsDevIds: ["nvidia"],
    chat: "https://integrate.api.nvidia.com/v1",
    website: "https://build.nvidia.com",
    keysUrl: "https://build.nvidia.com/settings/api-keys",
  }),
  // 魔搭的 API-Inference，key 是 ModelScope 的访问令牌；不是千问模板用的 DashScope。
  template({
    id: "modelscope",
    name: "ModelScope",
    group: "relay",
    modelsDevIds: ["modelscope"],
    chat: "https://api-inference.modelscope.cn/v1",
    responses: "https://api-inference.modelscope.cn/v1",
    note: "魔搭 · API-Inference",
    website: "https://modelscope.cn/docs/model-service/API-Inference/intro",
    keysUrl: "https://modelscope.cn/my/myaccesstoken",
  }),
  template({
    id: "aihubmix",
    name: "AiHubMix",
    group: "relay",
    chat: "https://aihubmix.com/v1",
    anthropic: "https://aihubmix.com",
    website: "https://aihubmix.com",
    keysUrl: "https://console.aihubmix.com/token",
  }),
  // 一把 key 用所有厂商：Chat 走它的转换器，GPT 走它自己的 Responses，Claude 走它自己的 Messages。
  template({
    id: "pipellm",
    name: "PipeLLM",
    group: "relay",
    chat: "https://api.pipellm.ai/openai/v1",
    responses: "https://api.pipellm.ai/v1",
    anthropic: "https://api.pipellm.ai",
    website: "https://www.pipellm.ai",
    keysUrl: "https://console.pipellm.ai",
  }),
  template({
    id: "302ai",
    name: "302.AI",
    group: "relay",
    chat: "https://api.302.ai/v1",
    anthropic: "https://api.302.ai",
    website: "https://302.ai",
    keysUrl: "https://302.ai/api-keys/list",
  }),
  template({
    id: "cherryin",
    name: "CherryIN",
    group: "relay",
    chat: "https://open.cherryin.ai/v1",
    responses: "https://open.cherryin.ai/v1",
    anthropic: "https://open.cherryin.ai",
    website: "https://open.cherryin.ai",
    keysUrl: "https://open.cherryin.ai/console/token",
  }),
  template({
    id: "yylx",
    name: "鱼鱼连线",
    group: "relay",
    chat: "https://app.yylx.io/v1",
    anthropic: "https://app.yylx.io",
    website: "https://yylx.io",
    keysUrl: "https://app.yylx.io/keys",
    regions: [
      region({
        id: "auto",
        name: "Auto",
        chat: "https://app.yylx.io/v1",
        anthropic: "https://app.yylx.io",
      }),
      region({
        id: "global",
        name: "Global",
        chat: "https://global.yylx.io/v1",
        anthropic: "https://global.yylx.io",
      }),
      region({
        id: "cn",
        name: "China Mainland",
        chat: "https://cn.yylx.io/v1",
        anthropic: "https://cn.yylx.io",
      }),
    ],
  }),
];

/*
 * 本机服务（照 magpie KindLocal）：不要 key，地址是这台电脑上的默认端口。服务可能换了端口或在别的电脑上，表单只要一个服务地址，
 * 改它只换各格式地址的协议、主机、端口，路径不变（magpie local_address.go，客户端做）。oMLX、MLX-Serve 的决策模型地址不收。
 */
const LOCALS: ApiEndpointTemplate[] = [
  template({
    id: "ollama",
    name: "Ollama",
    group: "local",
    keyOptional: true,
    chat: "http://localhost:11434/v1",
    anthropic: "http://localhost:11434",
    note: "your local models",
    website: "https://ollama.com",
  }),
  template({
    id: "lmstudio",
    name: "LM Studio",
    group: "local",
    keyOptional: true,
    chat: "http://localhost:1234/v1",
    note: "local server, port 1234 by default",
    website: "https://lmstudio.ai",
  }),
  template({
    id: "omlx",
    name: "oMLX",
    group: "local",
    keyOptional: true,
    chat: "http://localhost:8000/v1",
    responses: "http://localhost:8000/v1",
    anthropic: "http://localhost:8000",
    note: "local server, port 8000 by default",
    website: "https://omlx.ai",
  }),
  template({
    id: "mlx-serve",
    name: "MLX-Serve",
    group: "local",
    keyOptional: true,
    chat: "http://localhost:11234/v1",
    responses: "http://localhost:11234/v1",
    anthropic: "http://localhost:11234",
    note: "local server, port 11234 by default",
    website: "https://github.com/ddalcu/mlx-serve",
  }),
];

export const API_ENDPOINT_TEMPLATES: readonly ApiEndpointTemplate[] = [
  ...VENDORS,
  ...RELAYS,
  ...LOCALS,
];

export function findTemplate(id: string): ApiEndpointTemplate | null {
  return API_ENDPOINT_TEMPLATES.find((candidate) => candidate.id === id) ?? null;
}

/** 接口记下的模板与区域或套餐（「自定义」加的都没有）。 */
export interface TemplatePlace {
  templateId?: string;
  region?: string;
}

function templateRegionOf(place: TemplatePlace): {
  placeTemplate: ApiEndpointTemplate | null;
  placeRegion: ApiEndpointTemplateRegion | null;
} {
  const placeTemplate = place.templateId === undefined ? null : findTemplate(place.templateId);
  const placeRegion =
    placeTemplate?.regions?.find((candidate) => candidate.id === place.region) ?? null;
  return { placeTemplate, placeRegion };
}

/**
 * 这家没有清单接口可问（照 magpie models.go 的 NoList）：模板说没有，所在的区域或套餐也没说它有（listsModels，
 * 如千帆按量付费的 /v2/models）。这时拉模型不向上游发请求，清单就是内置的那份。
 */
export function listsNoModels(place: TemplatePlace): boolean {
  const { placeTemplate, placeRegion } = templateRegionOf(place);
  return placeTemplate?.noModelList === true && placeRegion?.listsModels !== true;
}

/**
 * 套餐自己的模型（照 magpie planModels）：模板有 modelIdPrefix 时只留以它开头的（一把 key 还能买别的，如 ClinePass）；
 * 没留下的、或上游清单是空的而套餐有内置清单时，给内置清单（区域或套餐自己的优先）。别的接口的清单原样返回。
 */
export function planModelsOf<T extends { id: string }>(
  place: TemplatePlace,
  listed: T[],
): (T | { id: string })[] {
  const { placeTemplate, placeRegion } = templateRegionOf(place);
  if (!placeTemplate) return listed;
  const builtIn = placeRegion?.models ?? placeTemplate.models ?? [];
  const prefix = placeTemplate.modelIdPrefix ?? "";
  if (prefix === "" && (builtIn.length === 0 || listed.length > 0)) return listed;
  const kept = listed.filter((model) => model.id.startsWith(prefix));
  return kept.length > 0 ? kept : builtIn.map((id) => ({ id }));
}

/** 由模板决定的 key 请求头：只放 x-api-key、只放 Bearer、放 Azure 的 api-key。 */
export type TemplateKeyHeaders = Extract<KeyHeaders, "xApiKey" | "bearer" | "apiKey">;

/**
 * key 放哪个头由模板决定的两家（照 magpie AuthHeaders）：Bedrock 的 Anthropic 地址只收 x-api-key（两个都带会被拒），
 * 其余格式只收 Bearer；Azure 的 key 放 api-key（Bearer 在那里是 Entra ID 令牌），Anthropic 格式例外用 x-api-key。
 * 别的模板与「自定义」为 null，按通常的规则。中转站转发、测试、拉模型都照这个。
 */
export function templateKeyHeaders(input: {
  templateId: string | undefined;
  format: ApiEndpointRequestFormat;
}): TemplateKeyHeaders | null {
  const anthropic = input.format === "anthropic_messages";
  if (input.templateId === BEDROCK_TEMPLATE_ID) return anthropic ? "xApiKey" : "bearer";
  if (input.templateId === AZURE_TEMPLATE_ID) return anthropic ? "xApiKey" : "apiKey";
  return null;
}

/** Bedrock 的 Claude id：模型 id（anthropic.claude-opus-4-8）或推理配置的（apac.anthropic.claude-opus-5-5）。 */
export function isBedrockClaude(model: string): boolean {
  return model.toLowerCase().includes("anthropic.claude");
}

/** Bedrock 上 OpenAI 闭源的 GPT（global.openai.gpt-6-luna）：Responses 与 Chat 都有，工具加推理只在 Responses 上；gpt-oss 不算。 */
function isBedrockGpt(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes("openai.gpt-") && !lower.includes("gpt-oss");
}

/**
 * 这家给这个模型的格式，按先后（照 magpie account.go 的 Bedrock 一段与 ResponsesFirst）：Bedrock 没有清单说这个，
 * Claude 只在 Anthropic 上，OpenAI 的 GPT 先 Responses 再 Chat，其余（gpt-oss 也是）只在 Chat 上。
 * 别的接口为 null：每个格式的地址都给每个模型。
 */
export function modelFormatsAt(input: {
  templateId: string | undefined;
  model: string;
}): ApiEndpointRequestFormat[] | null {
  if (input.templateId !== BEDROCK_TEMPLATE_ID) return null;
  if (isBedrockClaude(input.model)) return ["anthropic_messages"];
  if (isBedrockGpt(input.model)) return ["openai_responses", "openai_chat"];
  return ["openai_chat"];
}

/** 这家有地址、又给这个模型的格式（Bedrock 按 modelFormatsAt 只留几种），按这家地址的顺序。 */
export function servedFormats(input: {
  templateId: string | undefined;
  baseUrls: readonly { format: ApiEndpointRequestFormat }[];
  model: string;
}): ApiEndpointRequestFormat[] {
  const served = modelFormatsAt(input);
  const formats = input.baseUrls.map((entry) => entry.format);
  return served === null ? formats : formats.filter((format) => served.includes(format));
}

/** OpenAI 自己的模型名（magpie openAIModel）：gpt-、codex 或 o 加数字开头，取最后一个斜杠之后的部分。 */
export function isOpenAIModel(model: string): boolean {
  const bare = model.slice(model.lastIndexOf("/") + 1).toLowerCase();
  return bare.startsWith("gpt-") || bare.startsWith("codex") || /^o\d/.test(bare);
}

/**
 * 要翻译时先试哪种格式（照 magpie ResponsesFirst）：Bedrock 按它给这个模型的先后；Azure 上按 OpenAI 模型命名的部署
 * 先 Responses 再 Chat（部署名随用户起，按模型起名的才当作那个模型）。别的为 null，按中转站通常的翻译顺序。
 */
export function translationOrderAt(input: {
  templateId: string | undefined;
  model: string;
}): ApiEndpointRequestFormat[] | null {
  if (input.templateId === BEDROCK_TEMPLATE_ID) return modelFormatsAt(input);
  if (input.templateId === AZURE_TEMPLATE_ID && isOpenAIModel(input.model)) {
    return ["openai_responses", "openai_chat", "anthropic_messages"];
  }
  return null;
}

// Azure 资源所在主机的结尾（新资源也给 cognitiveservices.azure.com、services.ai.azure.com）。
const AZURE_HOST_SUFFIXES = [
  ".openai.azure.com",
  ".cognitiveservices.azure.com",
  ".services.ai.azure.com",
];

export function isAzureHost(host: string): boolean {
  return AZURE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/**
 * Azure 模板的地址放到资源的 v1 API 上（照 magpie AzureBase、azureEndpoints）：不论从门户或别的软件怎么粘来
 * ——资源本身、…/openai、…/openai/v1、带 api-version 的旧部署地址，或只有资源名——都换成 https://<资源主机>/openai/v1。
 * 不是 Azure 资源主机的（前面挡着 API Management 的网关、本机的假上游）原样不动。
 */
export function azureResourceBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(withScheme)) return raw;
  let host = new URL(withScheme).host.toLowerCase();
  // 门户里列的只有资源名。
  if (host !== "" && !/[.:]/.test(host)) host += ".openai.azure.com";
  return isAzureHost(host) ? `https://${host}/openai/v1` : raw;
}

/** 保存从 Azure 模板加的接口时，Chat 与 Responses 地址都放到资源的 v1 API 上；别的模板原样。 */
export function templateBaseUrls<T extends { format: string; url: string }>(input: {
  templateId: string | undefined;
  baseUrls: T[];
}): T[] {
  const { templateId } = input;
  return input.baseUrls.map((entry) => ({
    ...entry,
    url: templateBaseUrl({ templateId, ...entry }),
  }));
}

/** 一种格式的地址按模板放好（同 templateBaseUrls）：保存前拉模型、测试连接也这样问。 */
export function templateBaseUrl(input: {
  templateId: string | undefined;
  format: string;
  url: string;
}): string {
  const isAzureOpenAi =
    input.templateId === AZURE_TEMPLATE_ID && input.format !== "anthropic_messages";
  return isAzureOpenAi ? azureResourceBaseUrl(input.url) : input.url;
}

/** Azure 的部署名清单（数据面只有这个 api-version 还给 key 列部署）；列不出时再列 v1 API 的模型（照 magpie azureModels）。 */
const AZURE_DEPLOYMENTS_VERSION = "2022-12-01";

/** 列模型时依次问的地址：Azure 先问部署名、再问 v1 的 /models；别的接口为 null，按通常的 /v1/models 与 /models。 */
export function templateModelListUrls(input: {
  templateId: string | undefined;
  baseUrl: string;
}): string[] | null {
  if (input.templateId !== AZURE_TEMPLATE_ID) return null;
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const root = base.replace(/\/v1$/, "");
  return [`${root}/deployments?api-version=${AZURE_DEPLOYMENTS_VERSION}`, `${base}/models`];
}
