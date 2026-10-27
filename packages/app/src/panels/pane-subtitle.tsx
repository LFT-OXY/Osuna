import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * One muted line of facts about a pane's agent, under the pane's header and above its stream:
 * model, thinking, tokens. Provider subagents get it from the daemon; a Paseo agent shown without
 * its composer gets it from the same facts the composer's controls show.
 */
export function PaneSubtitle({ text, testID }: { text: string; testID?: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.text} numberOfLines={1} testID={testID}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    // Osuna 的工作区不画横向分割线。
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
