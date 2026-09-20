import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { UnistylesRuntime } from "react-native-unistyles";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAppSettings } from "@/hooks/use-settings";
import {
  rememberPluginThemeHost,
  usePluginThemeCatalog,
  type PluginThemeOption,
} from "@/plugins/themes";
import { PLUGIN_THEME_NAMES, PLUGIN_THEME_PREFERENCE } from "@/styles/theme";
import { applyAppearance } from "./apply";
import { resolveActiveTheme, type ResolveActiveThemeInput } from "./resolve-theme";

interface ContributedThemes {
  options: PluginThemeOption[];
  selected: PluginThemeOption | null;
  select: (option: PluginThemeOption) => void;
}

interface ApplyThemeInput extends Omit<ResolveActiveThemeInput, "contributedColorScheme"> {
  contributedTheme: PluginThemeOption | null;
}

const ContributedThemesContext = createContext<ContributedThemes | null>(null);

// "auto" 不交给 Unistyles 自适应：它只会在 light / dark 两个注册槽位间切换，
// 无法表达"系统深色用 X、浅色用 Y"。这里始终关闭自适应并显式 setTheme。
function applyTheme({ contributedTheme, ...input }: ApplyThemeInput): void {
  if (contributedTheme) {
    UnistylesRuntime.updateTheme(
      PLUGIN_THEME_NAMES[contributedTheme.theme.colorScheme],
      () => contributedTheme.theme,
    );
  }
  const themeName = resolveActiveTheme({
    ...input,
    contributedColorScheme: contributedTheme?.theme.colorScheme ?? null,
  });
  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(themeName);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings, isLoading } = useAppSettings();
  const [hasAppliedAppearance, setHasAppliedAppearance] = useState(false);
  const options = usePluginThemeCatalog();
  const systemColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const selected = useMemo(() => {
    if (settings.theme !== PLUGIN_THEME_PREFERENCE) return null;
    return options.find((option) => option.id === settings.pluginThemeId) ?? null;
  }, [options, settings.pluginThemeId, settings.theme]);

  useEffect(() => {
    if (isLoading) return;
    applyTheme({
      preference: settings.theme,
      autoDarkTheme: settings.autoDarkTheme,
      autoLightTheme: settings.autoLightTheme,
      systemColorScheme,
      contributedTheme: selected,
    });
    applyAppearance({
      uiFontFamily: settings.uiFontFamily,
      monoFontFamily: settings.monoFontFamily,
      uiBaseFontSize: settings.uiBaseFontSize,
      contentFontSize: settings.contentFontSize,
      codeFontSize: settings.codeFontSize,
      syntaxTheme: settings.syntaxTheme,
    });
    setHasAppliedAppearance(true);
  }, [
    isLoading,
    selected,
    systemColorScheme,
    settings.theme,
    settings.autoDarkTheme,
    settings.autoLightTheme,
    settings.uiFontFamily,
    settings.monoFontFamily,
    settings.uiBaseFontSize,
    settings.contentFontSize,
    settings.codeFontSize,
    settings.syntaxTheme,
  ]);

  const select = useCallback(
    (option: PluginThemeOption) => {
      rememberPluginThemeHost(option);
      void updateSettings({
        theme: PLUGIN_THEME_PREFERENCE,
        pluginThemeId: option.id,
      });
    },
    [updateSettings],
  );
  const value = useMemo(() => ({ options, selected, select }), [options, selected, select]);

  // The first settings load changes appearance keys. Mount screens only after applying it
  // so startup does not destroy and recreate an already-visible workspace.
  if (!hasAppliedAppearance) return null;

  return (
    <ContributedThemesContext.Provider value={value}>{children}</ContributedThemesContext.Provider>
  );
}

export function useContributedThemes(): ContributedThemes {
  const themes = useContext(ContributedThemesContext);
  if (themes === null) throw new Error("useContributedThemes requires AppearanceProvider");
  return themes;
}
