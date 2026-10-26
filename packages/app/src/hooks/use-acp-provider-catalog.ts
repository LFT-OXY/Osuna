import { useCallback, useState } from "react";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { ACP_PROVIDER_CATALOG, type AcpProviderCatalogEntry } from "@/data/acp-provider-catalog";

export type AcpProviderCatalogItem = AcpProviderCatalogEntry;

export function getAcpProviderCatalog(): AcpProviderCatalogItem[] {
  return ACP_PROVIDER_CATALOG;
}

/** Config owns derived providers and opt-in bundled catalog providers; only those can be removed. */
export function isConfigOwnedProvider(
  config: Pick<MutableDaemonConfig, "providers"> | null | undefined,
  providerId: string,
): boolean {
  const providerConfig = config?.providers?.[providerId];
  if (!providerConfig) return false;
  if (providerConfig.extends) return true;
  return ACP_PROVIDER_CATALOG.some((entry) => entry.id === providerId && entry.bundledProvider);
}

export function buildAcpProviderConfigPatch(
  entry: AcpProviderCatalogItem,
  supportsHopliteProvider = false,
): MutableDaemonConfigPatch {
  if (entry.bundledProvider) {
    // COMPAT(hopliteProvider): added in v0.18.0, remove after 2027-04-15 once host floor includes the bundled adapter.
    if (!supportsHopliteProvider) {
      throw new Error(
        i18n.t("providerCatalog.errors.hostUpdateRequired", { provider: entry.title }),
      );
    }
    return { providers: { [entry.id]: { enabled: true } } };
  }
  return {
    providers: {
      [entry.id]: {
        extends: "acp",
        label: entry.title,
        description: entry.description,
        command: [...entry.command],
        env: entry.env ? { ...entry.env } : {},
        ...(entry.params ? { params: { ...entry.params } } : {}),
      },
    },
  };
}

export function useAcpProviderCatalog() {
  const [entries] = useState<AcpProviderCatalogItem[]>(ACP_PROVIDER_CATALOG);

  const refetch = useCallback(async () => entries, [entries]);

  return { entries, loading: false, error: null, refetch };
}
