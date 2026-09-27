import { useMemo } from "react";
import { Image } from "react-native";
import { SvgPathIcon, type SvgPathIconProps } from "./svg-path-icon";

// 由 scripts/generate-osuna-icons.mjs 从源图派生，底板满版裁切。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSUNA_LOGO_IMAGE = require("../../../assets/images/osuna-logo.png");

// 按源图描出的折纸鸟剪影，供 16px 这类小尺寸单色使用。
// 第二段是翅膀下的空洞，绕向与外轮廓相反，nonzero 填充时被挖空。
const OSUNA_GLYPH_VIEW_BOX = "11.75 7.25 84 84";
const OSUNA_GLYPH_PATH =
  "M14 12L45 20.5L52 22.5L58 26L63 31L70.5 41L77.5 36L86 37L93.5 44L84.5 44.5L82 55L80 60L77.5 64.5L70 69L62 74L54 81.5L60 86.5L55 85L48 83L40 79.5L32 75.5L25.5 70.5L20.5 64.5L17 59L16.5 55L22 46L27 39L32.5 35L26 30.5L20 24ZM28 44.5L43 69L57 71.5L61.5 50.5L38.5 38.5Z";

interface OsunaLogoProps {
  size?: number;
}

export function OsunaLogo({ size = 64 }: OsunaLogoProps) {
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  return <Image source={OSUNA_LOGO_IMAGE} style={style} resizeMode="contain" />;
}

export function OsunaGlyph(props: SvgPathIconProps) {
  return <SvgPathIcon {...props} path={OSUNA_GLYPH_PATH} viewBox={OSUNA_GLYPH_VIEW_BOX} />;
}
