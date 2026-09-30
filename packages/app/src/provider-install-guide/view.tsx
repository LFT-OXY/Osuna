import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { openExternalUrl } from "@/utils/open-external-url";
import { ProviderInstallGuideSurface, type ProviderInstallGuide } from "./index";

/*
 * 剪贴板（expo-clipboard）在单测运行器里无法解析，而 surface 的 jsdom 测试会导入入口文件，
 * 所以运行时接线放在这里；调用方从这里导入。
 */

export function ProviderInstallGuideView({
  guide,
  cliLabel,
}: {
  guide: ProviderInstallGuide;
  cliLabel: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const handleCopyCommand = useCallback(
    (command: string) => {
      void copyToClipboard(command)
        .then(() => toast.copied(t("settings.providers.install.copyLabel")))
        .catch(() => toast.error(t("settings.providers.install.copyFailed")));
    },
    [t, toast],
  );

  const handleOpenDocs = useCallback((url: string) => {
    void openExternalUrl(url);
  }, []);

  return (
    <ProviderInstallGuideSurface
      guide={guide}
      cliLabel={cliLabel}
      onCopyCommand={handleCopyCommand}
      onOpenDocs={handleOpenDocs}
    />
  );
}
