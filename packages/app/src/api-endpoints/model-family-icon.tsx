import React from "react";
import { withUnistyles } from "react-native-unistyles";
import { Boxes } from "lucide-react-native";
import { SvgIcon } from "@/components/provider-icons";
import { MODEL_FAMILY_ICON_SVGS } from "@/assets/model-family-icons";
import type { Theme } from "@/styles/theme";
import { MODEL_FAMILIES, type ModelFamilyId } from "./internal/model-families";

const ThemedSvgIcon = withUnistyles(SvgIcon);
const ThemedBoxes = withUnistyles(Boxes);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/** 家族的厂商图标；彩色的自带颜色，单色的跟前景色；「其他」用通用图标。 */
export function ModelFamilyIcon({ family, size }: { family: ModelFamilyId; size: number }) {
  const icon = MODEL_FAMILIES.find((candidate) => candidate.id === family)?.icon ?? null;
  if (icon === null) return <ThemedBoxes size={size} uniProps={foregroundColorMapping} />;
  return (
    <ThemedSvgIcon
      svg={MODEL_FAMILY_ICON_SVGS[icon]}
      size={size}
      uniProps={foregroundColorMapping}
    />
  );
}
