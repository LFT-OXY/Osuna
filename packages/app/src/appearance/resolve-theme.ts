import { DEFAULT_THEME_PREFERENCE } from "@/hooks/use-settings/storage";
import {
  PLUGIN_THEME_NAMES,
  PLUGIN_THEME_PREFERENCE,
  REGISTERED_THEMES,
  THEME_TO_UNISTYLES,
  type DarkThemeName,
  type LightThemeName,
  type ThemePreference,
} from "@/styles/theme";

export type SystemColorScheme = "light" | "dark";
export type ActiveThemeName = keyof typeof REGISTERED_THEMES;

export interface ResolveActiveThemeInput {
  preference: ThemePreference;
  autoDarkTheme: DarkThemeName;
  autoLightTheme: LightThemeName;
  systemColorScheme: SystemColorScheme;
  /** Color scheme of the selected plugin theme, or null when none is selected or installed. */
  contributedColorScheme: SystemColorScheme | null;
}

export type BuiltInThemePreference = Exclude<ThemePreference, typeof PLUGIN_THEME_PREFERENCE>;

// 选中的插件主题一旦不再安装，app 就按默认偏好渲染；设置页与解析器都用这一条折算。
export function toBuiltInPreference(preference: ThemePreference): BuiltInThemePreference {
  return preference === PLUGIN_THEME_PREFERENCE ? DEFAULT_THEME_PREFERENCE : preference;
}

// 把用户偏好 + 系统深浅 + 插件主题状态折算成一个 Unistyles 注册名。
// "auto" 不再交给 Unistyles 自适应（它只能在 light / dark 两个槽位间切换），
// 而是按系统深浅在用户配对的两套主题里选一套。
export function resolveActiveTheme(input: ResolveActiveThemeInput): ActiveThemeName {
  if (input.contributedColorScheme) {
    return PLUGIN_THEME_NAMES[input.contributedColorScheme];
  }
  const preference = toBuiltInPreference(input.preference);
  if (preference === "auto") {
    return THEME_TO_UNISTYLES[
      input.systemColorScheme === "dark" ? input.autoDarkTheme : input.autoLightTheme
    ];
  }
  return THEME_TO_UNISTYLES[preference];
}
