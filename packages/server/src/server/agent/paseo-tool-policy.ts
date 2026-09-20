import type { ProviderOsunaToolsPolicy } from "@osuna/protocol/provider-config";

interface ProviderPaseoToolSettings {
  osunaTools?: ProviderOsunaToolsPolicy;
}

export function resolvePaseoToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderPaseoToolSettings>> | undefined,
): ProviderOsunaToolsPolicy | undefined {
  return providerSettings?.[providerId]?.osunaTools;
}

export function isPaseoToolEnabled(
  policy: ProviderOsunaToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isPaseoToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isPaseoToolPolicyEnabled(policy: ProviderOsunaToolsPolicy | undefined): boolean {
  return policy?.enabled !== false;
}
