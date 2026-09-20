import type { ProviderOsunaToolsPolicy } from "@osuna/protocol/provider-config";

interface ProviderOsunaToolSettings {
  osunaTools?: ProviderOsunaToolsPolicy;
}

export function resolveOsunaToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderOsunaToolSettings>> | undefined,
): ProviderOsunaToolsPolicy | undefined {
  return providerSettings?.[providerId]?.osunaTools;
}

export function isOsunaToolEnabled(
  policy: ProviderOsunaToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isOsunaToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isOsunaToolPolicyEnabled(policy: ProviderOsunaToolsPolicy | undefined): boolean {
  return policy?.enabled !== false;
}
