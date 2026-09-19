import { Fragment } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProviderUsageCard } from "./card";
import type { ProviderUsage } from "./types";

/**
 * 供应商之间用一条分隔线，外壳由调用方给：「用量」页把它放进 `UsageCard`，
 * 自己再包一层卡片会变成双层边框。
 */
export function ProviderUsageList({ providers }: { providers: ProviderUsage[] }) {
  return (
    <View style={styles.list}>
      {providers.map((usage, index) => (
        <Fragment key={usage.providerId}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <ProviderUsageCard usage={usage} />
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[3],
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
}));
