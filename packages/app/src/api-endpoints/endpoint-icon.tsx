import { Buffer } from "buffer";
import React, { createContext, useContext, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgIcon, scopeSvgIds } from "@/components/provider-icons";
import { Text } from "@/components/ui/text";
import {
  ENDPOINT_TEMPLATE_ICON_PNGS,
  ENDPOINT_TEMPLATE_ICON_SVGS,
} from "@/assets/endpoint-template-icons";
import { MODEL_FAMILY_ICON_SVGS } from "@/assets/model-family-icons";
import { isWeb } from "@/constants/platform";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { TextVariant, Theme } from "@/styles/theme";

const ThemedSvgIcon = withUnistyles(SvgIcon);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const FAMILY = MODEL_FAMILY_ICON_SVGS;
const OWN = ENDPOINT_TEMPLATE_ICON_SVGS;
const PNG = ENDPOINT_TEMPLATE_ICON_PNGS;

type BuiltInIcon = { kind: "svg"; svg: string } | { kind: "png"; uri: string };

function svg(markup: string): BuiltInIcon {
  return { kind: "svg", svg: markup };
}

function png(uri: string): BuiltInIcon {
  return { kind: "png", uri };
}

// 内置图标，按 magpie 的图标名（icons/ 下的文件名去掉扩展名）：模板用的与「自定义」接口可挑的（magpie 模板的图标加 MORE_ICONS）。
const BUILT_IN_ICONS: Readonly<Record<string, BuiltInIcon>> = {
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
  "tiangong-color": svg(OWN.tiangong),
  "together-color": svg(OWN.together),
  typesafe: png(PNG.typesafe),
  "upstage-color": svg(OWN.upstage),
  "venice-color": svg(OWN.venice),
  vercel: svg(OWN.vercel),
  "vertexai-color": svg(OWN.vertexai),
  "vllm-color": svg(OWN.vllm),
  "volcengine-color": svg(OWN.volcengine),
  "voyage-color": svg(OWN.voyage),
  "wenxin-color": svg(OWN.wenxin),
  windsurf: svg(OWN.windsurf),
  "workersai-color": svg(OWN.workersai),
  xai: svg(FAMILY.xai),
  xiaomimimo: svg(OWN.xiaomimimo),
  "xinference-color": svg(OWN.xinference),
  yi: svg(OWN.yi),
  "yuanbao-color": svg(OWN.yuanbao),
  yylx: svg(OWN.yylx),
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
const TEMPLATE_ICONS: Readonly<Record<string, string>> = {
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

/** 取存下的图标要问哪台主机；接口列表页与详情页提供，模板列表不用。 */
const EndpointIconHostContext = createContext<string | null>(null);

export function EndpointIconHostProvider({
  serverId,
  children,
}: {
  serverId: string;
  children: React.ReactNode;
}) {
  return (
    <EndpointIconHostContext.Provider value={serverId}>{children}</EndpointIconHostContext.Provider>
  );
}

/**
 * 接口或模板的图标：接口自选的（内置图标名或存下的图片）优先，其次按模板 id 取品牌图标，都没有（「自定义」、不认识的模板、
 * 图片还没取到或已不在）用名称首字，字号由调用方给。彩色的自带颜色，单色的跟前景色。
 */
export function EndpointIcon({
  icon,
  templateId,
  name,
  size,
  initialVariant,
}: {
  // 接口自选的图标；没选为 null。
  icon: string | null;
  templateId: string | null;
  name: string;
  size: number;
  initialVariant: TextVariant;
}) {
  if (icon !== null && isStoredIcon(icon)) {
    return <StoredIcon icon={icon} size={size} name={name} initialVariant={initialVariant} />;
  }
  const builtIn = builtInIconOf({ icon, templateId });
  if (builtIn === null) return <Initial name={name} variant={initialVariant} />;
  return <BuiltInIconView icon={builtIn} size={size} />;
}

/** 内置图标名画出来的样子（挑选格子用）；认不出的名字画不出，为 null。 */
export function BuiltInEndpointIcon({ name, size }: { name: string; size: number }) {
  const icon = BUILT_IN_ICONS[name] ?? null;
  if (icon === null) return null;
  return <BuiltInIconView icon={icon} size={size} />;
}

function builtInIconOf(input: {
  icon: string | null;
  templateId: string | null;
}): BuiltInIcon | null {
  const ownIcon = input.icon === null ? null : (BUILT_IN_ICONS[input.icon] ?? null);
  if (ownIcon !== null) return ownIcon;
  const templateIcon =
    input.templateId === null ? null : (TEMPLATE_ICONS[input.templateId] ?? null);
  return templateIcon === null ? null : (BUILT_IN_ICONS[templateIcon] ?? null);
}

function Initial({ name, variant }: { name: string; variant: TextVariant }) {
  return <Text variant={variant}>{Array.from(name.trim())[0]?.toUpperCase() ?? "?"}</Text>;
}

function BuiltInIconView({ icon, size }: { icon: BuiltInIcon; size: number }) {
  if (icon.kind === "png") return <ImageIcon uri={icon.uri} size={size} />;
  return <BrandIcon svg={icon.svg} size={size} />;
}

// 渐变 id 每个实例各带后缀，免得网页上同名 id 取到别处那份（见 provider-icons.ts）。
function BrandIcon({ svg: markup, size }: { svg: string; size: number }) {
  const suffix = useId().replace(/[^A-Za-z0-9_]/g, "");
  const scoped = useMemo(() => scopeSvgIds(markup, suffix), [markup, suffix]);
  return <ThemedSvgIcon svg={scoped} size={size} uniProps={foregroundColorMapping} />;
}

function ImageIcon({ uri, size }: { uri: string; size: number }) {
  const source = useMemo(() => ({ uri }), [uri]);
  const sizeStyle = useMemo(() => ({ width: size, height: size }), [size]);
  return <Image source={source} style={[styles.image, sizeStyle]} resizeMode="contain" />;
}

/**
 * 存下的图片：按主机与图标值取一次就一直用（按内容起名，内容不会变）。网页上一律当图片画（SVG 也不当标记插进页面）；
 * 原生端 Image 画不了 SVG，SVG 按标记画。没有主机可问（模板列表）时用首字。
 */
interface StoredIconProps {
  icon: string;
  size: number;
  // 图片取不到时画名称首字。
  name: string;
  initialVariant: TextVariant;
}

function StoredIcon(props: StoredIconProps) {
  const serverId = useContext(EndpointIconHostContext);
  if (serverId === null) return <Initial name={props.name} variant={props.initialVariant} />;
  return <StoredIconOnHost serverId={serverId} {...props} />;
}

function StoredIconOnHost({
  serverId,
  icon,
  size,
  name,
  initialVariant,
}: StoredIconProps & { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: ["api-endpoint-icon", serverId, icon],
    dataShape: "value",
    immutableWhen: () => true,
    enabled: Boolean(client) && isConnected,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const response = await client.apiEndpointReadIcon({ icon });
      if (response.error) throw new Error(response.error.message);
      return response.icon;
    },
  });
  const image = query.data ?? null;
  if (image === null) return <Initial name={name} variant={initialVariant} />;
  if (!isWeb && image.mimeType === "image/svg+xml") {
    return <BrandIcon svg={Buffer.from(image.data, "base64").toString("utf8")} size={size} />;
  }
  return <ImageIcon uri={`data:${image.mimeType};base64,${image.data}`} size={size} />;
}

const styles = StyleSheet.create({
  image: {
    flexShrink: 0,
  },
});
