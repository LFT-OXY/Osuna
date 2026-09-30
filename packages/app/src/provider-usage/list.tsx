import { Fragment } from "react";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { selectActiveApiEndpoint } from "@/api-endpoints";
import { ProviderUsageCard } from "./card";
import type { ProviderUsage } from "./types";

/**
 * 供应商之间用一条分隔线，外壳由调用方给：「用量」页把它放进 `UsageCard`，
 * 自己再包一层卡片会变成双层边框。
 */
export function ProviderUsageList({
  providers,
  snapshotEntries,
}: {
  providers: ProviderUsage[];
  // 同一主机的提供方快照，用来标注启用了第三方接口的提供方。
  snapshotEntries: readonly ProviderSnapshotEntry[] | undefined;
}) {
  return (
    <View style={styles.list}>
      {providers.map((usage, index) => {
        const activeApiEndpoint = selectActiveApiEndpoint(snapshotEntries, usage.providerId);
        return (
          <Fragment key={usage.providerId}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <ProviderUsageCard usage={usage} activeApiEndpoint={activeApiEndpoint} />
          </Fragment>
        );
      })}
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
