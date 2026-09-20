import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export interface UsageSegmentedOption<T extends string> {
  value: T;
  label: string;
  testID?: string;
}

interface UsageSegmentedControlProps<T extends string> {
  options: readonly UsageSegmentedOption<T>[];
  value: T;
  accessibilityLabel: string;
  onChange: (value: T) => void;
  testID?: string;
}

/**
 * The tiny switch a usage card wears in its header. It exists next to
 * `components/ui/segmented-control.tsx` because the usage page is its own
 * visual island and draws from `theme.colors.usage`, not the design tokens.
 */
export function UsageSegmentedControl<T extends string>({
  options,
  value,
  accessibilityLabel,
  onChange,
  testID,
}: UsageSegmentedControlProps<T>) {
  return (
    <View style={styles.container} accessibilityLabel={accessibilityLabel} testID={testID}>
      {options.map((option) => (
        <UsageSegment
          key={option.value}
          option={option}
          isSelected={option.value === value}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

function UsageSegment<T extends string>({
  option,
  isSelected,
  onChange,
}: {
  option: UsageSegmentedOption<T>;
  isSelected: boolean;
  onChange: (value: T) => void;
}) {
  const handlePress = useCallback(() => onChange(option.value), [onChange, option.value]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={[styles.segment, isSelected && styles.segmentSelected]}
      testID={option.testID}
    >
      <Text style={[styles.label, isSelected && styles.labelSelected]} numberOfLines={1}>
        {option.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      padding: 2,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: palette.segBorder,
      backgroundColor: palette.segBg,
    },
    segment: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 4,
    },
    segmentSelected: {
      backgroundColor: palette.segThumb,
    },
    label: {
      fontSize: 10,
      fontWeight: theme.fontWeight.medium,
      color: palette.inkMuted,
    },
    labelSelected: {
      color: palette.ink,
    },
  };
});
