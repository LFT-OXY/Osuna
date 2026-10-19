import {
  ENDPOINT_TEMPLATE_ICON_PNGS,
  ENDPOINT_TEMPLATE_ICON_SVGS,
} from "@/assets/endpoint-template-icons";
import { MODEL_FAMILY_ICON_SVGS } from "@/assets/model-family-icons";

/*
 * 接口图标的名字：内置图标按 magpie 的图标名（icons/ 下的文件名去掉扩展名），模板按 id 指到其中一个；
 * 接口自选的是内置图标名，或 `file:` 开头的、daemon 存的图片。画法在 endpoint-icon.tsx。
 */

const FAMILY = MODEL_FAMILY_ICON_SVGS;
const OWN = ENDPOINT_TEMPLATE_ICON_SVGS;
const PNG = ENDPOINT_TEMPLATE_ICON_PNGS;

export type BuiltInIcon = { kind: "svg"; svg: string } | { kind: "png"; uri: string };

function svg(markup: string): BuiltInIcon {
  return { kind: "svg", svg: markup };
}

/**
 * 只有一种深色的「彩色」图标（Voyage、鱼鱼连线）在深色主题下看不见：把那一种颜色换成前景色，跟单色图标一样跟着主题。
 */
function mono(markup: string): BuiltInIcon {
  return { kind: "svg", svg: markup.replace(/fill="#[0-9a-f]{3,6}"/gi, 'fill="currentColor"') };
}

function png(uri: string): BuiltInIcon {
  return { kind: "png", uri };
}

// 内置图标，按 magpie 的图标名（icons/ 下的文件名去掉扩展名）：模板用的与「自定义」接口可挑的（magpie 模板的图标加 MORE_ICONS）。
export const BUILT_IN_ICONS: Readonly<Record<string, BuiltInIcon>> = {
  ai21: svg(OWN.ai21),
  "ai302-color": svg(OWN.ai302),
  "ai360-color": svg(OWN.ai360),
  "aihubmix-color": svg(OWN.aihubmix),
  "alibaba-color": svg(OWN.alibaba),
  "alibabacloud-color": svg(OWN.alibabacloud),
  "anyscale-color": svg(OWN.anyscale),
  aws: svg(OWN.aws),
  "azure-color": svg(OWN.azure),
  "azureai-color": svg(OWN.azureai),
  "baichuan-color": svg(OWN.baichuan),
  "baidu-color": svg(OWN.baidu),
  "baiducloud-color": svg(OWN.baiducloud),
  "bailian-color": svg(OWN.bailian),
  baseten: svg(OWN.baseten),
  "bedrock-color": svg(OWN.bedrock),
  "burncloud-color": svg(OWN.burncloud),
  "bytedance-color": svg(OWN.bytedance),
  cerebras: svg(OWN.cerebras),
  "chatglm-color": svg(OWN.chatglm),
  "cherryin-color": svg(OWN.cherryin),
  chutes: svg(OWN.chutes),
  "claude-color": svg(FAMILY.claude),
  cline: svg(OWN.cline),
  "cloudflare-color": svg(OWN.cloudflare),
  "codebuddy-color": svg(OWN.codebuddy),
  "cohere-color": svg(OWN.cohere),
  "cometapi-color": svg(OWN.cometapi),
  commandcode: svg(OWN.commandcode),
  "copilot-color": svg(OWN.copilot),
  coze: svg(OWN.coze),
  "deepinfra-color": svg(OWN.deepinfra),
  "deepmind-color": svg(OWN.deepmind),
  "deepseek-color": svg(FAMILY.deepseek),
  "doubao-color": svg(OWN.doubao),
  "featherless-color": svg(OWN.featherless),
  "fireworks-color": svg(OWN.fireworks),
  friendli: svg(OWN.friendli),
  "gemini-color": svg(FAMILY.gemini),
  "gemma-color": svg(OWN.gemma),
  giteeai: svg(OWN.giteeai),
  github: svg(OWN.github),
  glama: svg(OWN.glama),
  gmicloud: svg(OWN.gmicloud),
  "google-color": svg(OWN.google),
  grok: svg(OWN.grok),
  groq: svg(OWN.groq),
  "huawei-color": svg(OWN.huawei),
  "huaweicloud-color": svg(OWN.huaweicloud),
  "huggingface-color": svg(OWN.huggingface),
  "hunyuan-color": svg(OWN.hunyuan),
  "hyperbolic-color": svg(OWN.hyperbolic),
  "iflytekcloud-color": svg(OWN.iflytekcloud),
  inference: svg(OWN.inference),
  "infinigence-color": svg(OWN.infinigence),
  "internlm-color": svg(OWN.internlm),
  jina: svg(OWN.jina),
  kilo: svg(OWN.kilo),
  kilocode: svg(OWN.kilocode),
  kimi: svg(FAMILY.kimi),
  "kling-color": svg(OWN.kling),
  lambda: svg(OWN.lambda),
  "leptonai-color": svg(OWN.leptonai),
  liquid: svg(OWN.liquid),
  llmapi: svg(OWN.llmapi),
  lmstudio: svg(OWN.lmstudio),
  longcat: svg(OWN.longcat),
  "metaai-color": svg(OWN.metaai),
  "microsoft-color": svg(OWN.microsoft),
  mimocode: svg(FAMILY.mimocode),
  "minimax-color": svg(FAMILY.minimax),
  "mistral-color": svg(FAMILY.mistral),
  "mlx-serve": png(PNG["mlx-serve"]),
  "modelscope-color": svg(OWN.modelscope),
  "monica-color": svg(OWN.monica),
  "morph-color": svg(OWN.morph),
  nebius: svg(OWN.nebius),
  "newapi-color": svg(OWN.newapi),
  nousresearch: svg(OWN.nousresearch),
  "nova-color": svg(OWN.nova),
  "novita-color": svg(OWN.novita),
  "nvidia-color": svg(OWN.nvidia),
  ollama: svg(OWN.ollama),
  omlx: svg(OWN.omlx),
  openai: svg(FAMILY.openai),
  opencode: svg(OWN.opencode),
  openrouter: svg(OWN.openrouter),
  openwebui: svg(OWN.openwebui),
  parasail: svg(OWN.parasail),
  "perplexity-color": svg(OWN.perplexity),
  "phala-color": svg(OWN.phala),
  "pipellm-color": svg(OWN.pipellm),
  poe: svg(OWN.poe),
  "ppio-color": svg(OWN.ppio),
  "qiniu-color": svg(OWN.qiniu),
  "qwen-color": svg(FAMILY.qwen),
  reka: svg(OWN.reka),
  replicate: svg(OWN.replicate),
  roocode: svg(OWN.roocode),
  "sambanova-color": svg(OWN.sambanova),
  "sensenova-color": svg(OWN.sensenova),
  "siliconcloud-color": svg(OWN.siliconcloud),
  "snowflake-color": svg(OWN.snowflake),
  "sophnet-color": svg(OWN.sophnet),
  "spark-color": svg(OWN.spark),
  "stepfun-color": svg(FAMILY.stepfun),
  "straico-color": svg(OWN.straico),
  "submodel-color": svg(OWN.submodel),
  "targon-color": svg(OWN.targon),
  "tencent-color": svg(OWN.tencent),
  "tencentcloud-color": svg(OWN.tencentcloud),
  "tiangong-color": svg(OWN.tiangong),
  "together-color": svg(OWN.together),
  typesafe: png(PNG.typesafe),
  "upstage-color": svg(OWN.upstage),
  "venice-color": svg(OWN.venice),
  vercel: svg(OWN.vercel),
  "vertexai-color": svg(OWN.vertexai),
  "vllm-color": svg(OWN.vllm),
  "volcengine-color": svg(OWN.volcengine),
  "voyage-color": mono(OWN.voyage),
  "wenxin-color": svg(OWN.wenxin),
  windsurf: svg(OWN.windsurf),
  "workersai-color": svg(OWN.workersai),
  xai: svg(FAMILY.xai),
  xiaomimimo: svg(OWN.xiaomimimo),
  "xinference-color": svg(OWN.xinference),
  yi: svg(OWN.yi),
  "yuanbao-color": svg(OWN.yuanbao),
  yylx: mono(OWN.yylx),
  zai: svg(OWN.zai),
  zenmux: svg(OWN.zenmux),
  zeroone: svg(OWN.zeroone),
  "zhipu-color": svg(FAMILY.zhipu),
};

/** 「自定义」接口可挑的内置图标名，按去掉 -color 的名字排（照 magpie iconPicker）。 */
export const PICKABLE_ENDPOINT_ICONS: readonly string[] = Object.keys(BUILT_IN_ICONS).sort((a, b) =>
  iconTitle(a).localeCompare(iconTitle(b)),
);

/** 图标在挑选格子里的名字，也是搜索看的（照 magpie）。 */
export function iconTitle(name: string): string {
  return name.replace(/-color$/, "");
}

// 按模板 id 取品牌图标名（照 magpie presets.go 的 Icon）。
export const TEMPLATE_ICONS: Readonly<Record<string, string>> = {
  anthropic: "claude-color",
  openai: "openai",
  deepseek: "deepseek-color",
  xai: "xai",
  moonshot: "kimi",
  "moonshot-cn": "kimi",
  "kimi-code": "kimi",
  "kimi-code-cn": "kimi",
  zhipu: "zhipu-color",
  zai: "zai",
  minimax: "minimax-color",
  "minimax-cn": "minimax-color",
  stepfun: "stepfun-color",
  "stepfun-cn": "stepfun-color",
  // 小米 MiMo 的图标是文字商标，缩到图标大小认不出，用首字。
  "baidu-qianfan": "baiducloud-color",
  "tencent-cloud": "tencentcloud-color",
  huaweicloud: "huaweicloud-color",
  volcengine: "volcengine-color",
  qwen: "qwen-color",
  "qwen-cn": "qwen-color",
  "qwen-token-plan": "qwen-color",
  "bailian-token-plan": "bailian-color",
  mistral: "mistral-color",
  groq: "groq",
  bedrock: "bedrock-color",
  azure: "azure-color",
  "ollama-cloud": "ollama",
  nous: "nousresearch",
  openrouter: "openrouter",
  "opencode-go": "opencode",
  clinepass: "cline",
  "opencode-zen": "opencode",
  kilo: "kilo",
  commandcode: "commandcode",
  together: "together-color",
  fireworks: "fireworks-color",
  siliconflow: "siliconcloud-color",
  nvidia: "nvidia-color",
  modelscope: "modelscope-color",
  aihubmix: "aihubmix-color",
  pipellm: "pipellm-color",
  "302ai": "ai302-color",
  cherryin: "cherryin-color",
  yylx: "yylx",
  ollama: "ollama",
  lmstudio: "lmstudio",
  omlx: "omlx",
  "mlx-serve": "mlx-serve",
};

const FILE_ICON_PREFIX = "file:";

/** 图标值是 daemon 存的图片副本（`file:` 开头），要经 read_icon 取回。 */
export function isStoredIcon(icon: string): boolean {
  return icon.startsWith(FILE_ICON_PREFIX);
}

export function builtInIconOf(input: {
  icon: string | null;
  templateId: string | null;
}): BuiltInIcon | null {
  const ownIcon = input.icon === null ? null : (BUILT_IN_ICONS[input.icon] ?? null);
  if (ownIcon !== null) return ownIcon;
  const templateIcon =
    input.templateId === null ? null : (TEMPLATE_ICONS[input.templateId] ?? null);
  return templateIcon === null ? null : (BUILT_IN_ICONS[templateIcon] ?? null);
}
