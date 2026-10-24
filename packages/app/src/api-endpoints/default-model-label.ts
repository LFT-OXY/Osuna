import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { DefaultModelOption } from "./internal/agent-settings";

/** 默认模型的显示：指定某一家的写成「模型名（接口名）」。 */
export function useDefaultModelLabel(): (option: DefaultModelOption) => string {
  const { t } = useTranslation();
  return useCallback(
    (option: DefaultModelOption) =>
      option.endpointName === null
        ? option.model
        : t("settings.apiEndpoints.agent.defaultModelOnEndpoint", {
            model: option.model,
            endpoint: option.endpointName,
          }),
    [t],
  );
}
