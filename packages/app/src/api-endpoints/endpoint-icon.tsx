import React, { useId, useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { SvgIcon, scopeSvgIds } from "@/components/provider-icons";
import { ENDPOINT_TEMPLATE_ICON_SVGS } from "@/assets/endpoint-template-icons";
import { MODEL_FAMILY_ICON_SVGS } from "@/assets/model-family-icons";
import type { Theme } from "@/styles/theme";

const ThemedSvgIcon = withUnistyles(SvgIcon);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const FAMILY = MODEL_FAMILY_ICON_SVGS;
const OWN = ENDPOINT_TEMPLATE_ICON_SVGS;

// 按模板 id 取品牌图标（照 magpie presets.go 的 Icon）；模型家族已有的那几个直接用家族图标。
const TEMPLATE_ICONS: Readonly<Record<string, string>> = {
  anthropic: FAMILY.claude,
  openai: FAMILY.openai,
  deepseek: FAMILY.deepseek,
  xai: FAMILY.xai,
  moonshot: FAMILY.kimi,
  "moonshot-cn": FAMILY.kimi,
  "kimi-code": FAMILY.kimi,
  "kimi-code-cn": FAMILY.kimi,
  zhipu: FAMILY.zhipu,
  zai: OWN.zai,
  minimax: FAMILY.minimax,
  "minimax-cn": FAMILY.minimax,
  stepfun: FAMILY.stepfun,
  "stepfun-cn": FAMILY.stepfun,
  xiaomi: FAMILY.mimocode,
  "baidu-qianfan": OWN.baiducloud,
  "tencent-cloud": OWN.tencentcloud,
  huaweicloud: OWN.huaweicloud,
  volcengine: OWN.volcengine,
  qwen: FAMILY.qwen,
  "qwen-cn": FAMILY.qwen,
  "qwen-token-plan": FAMILY.qwen,
  "bailian-token-plan": OWN.bailian,
  mistral: FAMILY.mistral,
  groq: OWN.groq,
  "ollama-cloud": OWN.ollama,
  nous: OWN.nousresearch,
  openrouter: OWN.openrouter,
  "opencode-go": OWN.opencode,
  clinepass: OWN.cline,
  "opencode-zen": OWN.opencode,
  kilo: OWN.kilo,
  commandcode: OWN.commandcode,
  together: OWN.together,
  fireworks: OWN.fireworks,
  siliconflow: OWN.siliconcloud,
  nvidia: OWN.nvidia,
  modelscope: OWN.modelscope,
  aihubmix: OWN.aihubmix,
  pipellm: OWN.pipellm,
  "302ai": OWN.ai302,
  cherryin: OWN.cherryin,
  yylx: OWN.yylx,
};

/**
 * 接口或模板的图标：按模板 id 取品牌图标，取不到（「自定义」、不认识的模板）用名称首字，字样由调用方给。
 * 彩色的自带颜色，单色的跟前景色。
 */
export function EndpointIcon({
  templateId,
  name,
  size,
  initialStyle,
}: {
  templateId: string | null;
  name: string;
  size: number;
  initialStyle: StyleProp<TextStyle>;
}) {
  const svg = templateId === null ? null : (TEMPLATE_ICONS[templateId] ?? null);
  if (svg === null) return <Text style={initialStyle}>{initialOf(name)}</Text>;
  return <BrandIcon svg={svg} size={size} />;
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

// 渐变 id 每个实例各带后缀，免得网页上同名 id 取到别处那份（见 provider-icons.ts）。
function BrandIcon({ svg, size }: { svg: string; size: number }) {
  const suffix = useId().replace(/[^A-Za-z0-9_]/g, "");
  const scoped = useMemo(() => scopeSvgIds(svg, suffix), [svg, suffix]);
  return <ThemedSvgIcon svg={scoped} size={size} uniProps={foregroundColorMapping} />;
}
