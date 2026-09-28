import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Box, X } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { SkillChip } from "./skill-chips";

// 浅蓝底与蓝描边都是 accent 叠一层半透明底层，不新增颜色角色，也不拖低文字的不透明度。
const SKILL_CHIP_FILL_OPACITY = 0.07;
const SKILL_CHIP_OUTLINE_OPACITY = 0.3;
const SKILL_CHIP_HEIGHT = 24;

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
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleRemove = useCallback(() => onRemove(chip.name), [chip.name, onRemove]);
  return (
    <View
      testID="composer-skill-chip"
      style={styles.body}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View pointerEvents="none" style={styles.fill} />
      <View pointerEvents="none" style={styles.outline} />
      {/* × 占图标的位置、同尺寸，出现时 chip 宽度不跳。 */}
      {showRemove ? (
        <Pressable
          testID="composer-skill-chip-remove"
          onPress={handleRemove}
          disabled={disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          style={styles.iconSlot}
        >
          <ThemedX size={ICON_SIZE.xs} uniProps={accentBrightIconMapping} />
        </Pressable>
      ) : (
        <View style={styles.iconSlot}>
          <ThemedBox size={ICON_SIZE.xs} uniProps={accentBrightIconMapping} />
        </View>
      )}
      <Text
        variant="caption"
        weight="medium"
        color="accentBright"
        numberOfLines={1}
        style={styles.name}
      >
        {chip.name}
      </Text>
    </View>
  );
}

const ThemedBox = withUnistyles(Box);
const ThemedX = withUnistyles(X);
const accentBrightIconMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

const styles = StyleSheet.create((theme) => ({
  body: {
    position: "relative",
    height: SKILL_CHIP_HEIGHT,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[1.5],
    paddingRight: theme.spacing[2],
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
  iconSlot: {
    width: ICON_SIZE.xs,
    height: ICON_SIZE.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    minWidth: 0,
    flexShrink: 1,
  },
}));
