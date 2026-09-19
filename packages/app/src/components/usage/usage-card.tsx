import type { ReactNode } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface UsageCardProps {
  title?: string;
  /**
   * The header's left slot when a card leads with controls instead of a name.
   * `title` and this are the same slot, and a `title` wins — pass one.
   */
  renderHeaderLeft?: () => ReactNode;
  /** A render function, not a node: `react-perf` rejects JSX travelling through a prop. */
  renderHeaderRight?: () => ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The one card shell for the usage page. */
export function UsageCard({
  title,
  renderHeaderLeft,
  renderHeaderRight,
  children,
  style,
  testID,
}: UsageCardProps) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {title || renderHeaderLeft || renderHeaderRight ? (
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title}</Text> : (renderHeaderLeft?.() ?? <View />)}
          {renderHeaderRight?.()}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A card whose contents belong to a later ticket; it still holds its slot. */
export function UsagePlaceholderCard({
  title,
  message,
  style,
  testID,
}: {
  title: string;
  message: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <UsageCard title={title} style={style} testID={testID}>
      <Text style={styles.placeholder}>{message}</Text>
    </UsageCard>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    card: {
      backgroundColor: palette.card,
      borderColor: palette.cardBorder,
      borderWidth: 1,
      borderRadius: 12,
      padding: theme.spacing[4],
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[3],
    },
    title: {
      fontSize: 14,
      fontWeight: theme.fontWeight.medium,
      color: palette.inkMuted,
      letterSpacing: 0.35,
    },
    placeholder: {
      fontSize: 13,
      color: palette.inkFaint,
      paddingVertical: theme.spacing[4],
    },
  };
});
