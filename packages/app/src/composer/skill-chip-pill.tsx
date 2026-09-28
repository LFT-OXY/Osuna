import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Box, X } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { ATTACHMENT_CONTENT_HEIGHT } from "@/components/attachment-pill";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { SkillChip } from "./skill-chips";

// 浅蓝底与蓝描边都是 accent 叠一层半透明底层，不新增颜色角色，也不拖低文字的不透明度。
const SKILL_CHIP_FILL_OPACITY = 0.1;
const SKILL_CHIP_OUTLINE_OPACITY = 0.4;

interface SkillChipPillProps {
  chip: SkillChip;
  disabled: boolean;
  onRemove: (name: string) => void;
  removeLabel: string;
}

export function SkillChipPill({ chip, disabled, onRemove, removeLabel }: SkillChipPillProps) {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const showRemove = isHovered || isNative || isCompact;
  const removeButtonStyle = useMemo(
    () => [styles.removeButton, !showRemove && styles.removeButtonHidden],
    [showRemove],
  );
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleRemove = useCallback(() => onRemove(chip.name), [chip.name, onRemove]);
  return (
    <View
      testID="composer-skill-chip"
      style={styles.envelope}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View style={styles.body}>
        <View pointerEvents="none" style={styles.fill} />
        <View pointerEvents="none" style={styles.outline} />
        <ThemedBox size={ICON_SIZE.sm} uniProps={accentBrightIconMapping} />
        <Text
          variant="label"
          weight="medium"
          color="accentBright"
          numberOfLines={1}
          style={styles.name}
        >
          {chip.name}
        </Text>
      </View>
      <Pressable
        testID="composer-skill-chip-remove"
        onPress={handleRemove}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        style={removeButtonStyle}
      >
        <ThemedX size={12} uniProps={foregroundMutedIconMapping} />
      </Pressable>
    </View>
  );
}

const ThemedBox = withUnistyles(Box);
const ThemedX = withUnistyles(X);
const accentBrightIconMapping = (theme: Theme) => ({ color: theme.colors.accentBright });
const foregroundMutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  envelope: {
    position: "relative",
  },
  // 与附件 pill 同高：48 的内容区加上下各一条描边。
  body: {
    height: ATTACHMENT_CONTENT_HEIGHT + theme.borderWidth[1] * 2,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
    opacity: SKILL_CHIP_FILL_OPACITY,
  },
  outline: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.accent,
    opacity: SKILL_CHIP_OUTLINE_OPACITY,
  },
  name: {
    minWidth: 0,
    flexShrink: 1,
  },
  removeButton: {
    position: "absolute",
    top: -8,
    left: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  removeButtonHidden: {
    opacity: 0,
    pointerEvents: "none",
  },
}));
