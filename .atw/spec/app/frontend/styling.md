# Styling

The app uses `react-native-unistyles` v3. The Babel plugin tracks theme dependencies inside style factories and updates native views without React renders. `docs/unistyles.md` is the full gotcha list; read it before any theme-dependent styling. This file is the short version reviewers apply.

## The default

```tsx
import { StyleSheet } from "react-native-unistyles";

const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
  },
}));
```

Almost 300 files do this. Theme values come from `styles/theme.ts`; the Unistyles runtime is configured in `styles/unistyles.ts`.

## `useUnistyles()` is banned

New code must not call it. It subscribes the component to every runtime change and returns a fresh object each time, which caused lockstep re-renders of warm subtrees in profiling. There are still 94 call sites (`components/import-session-sheet.tsx` has five); they are tolerated until touched and converted, and a PR that adds one is rejected. Alternatives in order:

1. `StyleSheet.create((theme) => …)` for anything that ends up in a `style` prop.
2. A literal constant or a static import (`baseColors`, theme-name constants, `type Theme`) for genuinely static values.
3. `withUnistyles(Component)` for a third-party prop that must be theme-reactive (`BlurView.tint`, `Image.tintColor`, bottom-sheet `backgroundStyle`). Mind the `> *` child-selector leak.
4. There is no step 4. File an issue and stop.

## Theme values that leave the app

A theme value that is sent over the wire rather than rendered (the terminal colors the daemon uses to answer TUI color queries) is a one-shot snapshot, not a style. Read it with `UnistylesRuntime.getTheme()` at the moment of use, in a plain function, and keep the mapping pure and unit-tested:

```ts
// terminal/view-attributes.ts
export function getCurrentTerminalViewAttributes(): TerminalViewAttributes | undefined {
  return toTerminalViewAttributes(UnistylesRuntime.getTheme().colors.terminal);
}
```

The function is deliberately not reactive; the create request is a one-shot. The Node test stub (`test-stubs/react-native-unistyles.ts`) exposes `UnistylesRuntime.getTheme()` and a `colors.terminal` palette so the snapshot can be asserted against the fixture theme.

The live path is separate and owned by `TerminalStreamController` (`terminal/runtime/terminal-stream-controller.ts`), not by a hook. The pane derives `toTerminalViewAttributes(theme.colors.terminal)` with `useMemo`, hands the controller a `useStableEvent` getter, and calls `controller.syncViewAttributes()` from an effect keyed on that value. The controller sends only when the value differs from what it last sent for this terminal, except `syncViewAttributes({ afterClaim: true })`, which the attach path and the pane-focus size claim call right after a `claim` resize: after a claim the daemon may hold another device's colors, so that push is never deduplicated. The feature-flag gate is inside `DaemonClient.sendTerminalViewAttributes`; the pane and the controller do not read `server_info.features` for this.

## Terminal contrast and content inset

Both live in the shared xterm runtime (`terminal/runtime/terminal-emulator-runtime.ts`), not in the pane or the DOM host component, because the runtime is the only layer that both mounts xterm and owns the fit.

- **Minimum contrast ratio** is derived from the `ITheme` by `resolveTerminalMinimumContrastRatio` (`terminal/runtime/terminal-contrast.ts`): 4.5 on a light background, 3 on a dark one, 1 (xterm's "off") when the theme colors are not `#rrggbb`. Light versus dark is the daemon's rule for `CSI ?996n` (background luminance below foreground means dark), not the app's theme switch and not a luminance threshold, so a TUI told "dark" by the daemon and the xterm that renders it never disagree. The runtime resolves it at mount and again in `setTheme`, and writes `terminal.options.minimumContrastRatio` only when the value changes: every write clears xterm's contrast color cache and repaints, so a light-to-light theme change must not write.
- **Content inset** is a `mount({ contentInset })` value in px. The runtime puts it on the root as `padding` with `box-sizing: border-box`, so the root keeps its size, the host shrinks, and the FitAddon (which only measures the host) computes rows and columns from the inner box. The web host component passes `SPACING[2]` as a static import (the token is static, so no theme subscription); the WebView entry passes nothing and gets no inset. The padding area is painted by the root's theme background, which the runtime already owns.
- Every light theme's `white`, `brightWhite`, `black` and `brightBlack` are grays that clear 3:1 on that theme's terminal background, and every theme's `foreground` / `foregroundMuted` clear 4.5 (light) or 3 (dark) on `surface0`; `terminal-contrast.test.ts` iterates the whole catalog, so retune the hexes freely as long as it holds. A palette whose own white sits on its background (Catppuccin Latte, One Light, Rosé Pine Dawn) gets its closest gray tier instead.

## Theme catalog

`THEME_OPTIONS` in `styles/theme.ts` is the one catalog: the picker, the settings schema, the Unistyles registration, the swatch table, and `DARK_THEME_NAMES` / `LIGHT_THEME_NAMES` are all derived from it. A new variant is one entry plus one `build*Theme(build*SemanticColors({...}))` call; nothing else lists themes, and the variant sets no redesign roles (see [Redesign roles](#redesign-roles-and-their-derivation)). `group` is `primary` / `dark` / `light` and the picker inserts a separator wherever it changes.

Terminal ANSI colors are per theme only when the config provides `terminalAnsi` (the 14 colored slots) and `terminalSelectionBackground`; a config without them shares `lightTerminalAnsi` / `darkTerminalAnsi` and the rgba selection. `black` / `brightBlack` are never in `terminalAnsi`: they come from `terminalBlack` / `terminalBrightBlack`, and on a palette dark variant they clear 1.5:1 and 2:1 on the terminal background (`terminal-contrast.test.ts` lists the six older dark themes as the exception; a new dark variant is covered without editing the test). `background` / `foreground` / `cursor` are always derived from `surface0` / `foreground`, so they stay pure `#rrggbb` for the daemon bridge above.

"System" is not Unistyles adaptive mode. `appearance/resolve-theme.ts` picks `autoDarkTheme` or `autoLightTheme` from the OS scheme (`hooks/use-color-scheme`) and the provider calls `setAdaptiveThemes(false)` + `setTheme(name)` every time; adaptive mode can only flip between the `light` and `dark` slots, and overwriting those slots would leak into a direct Light / Dark selection. `adaptiveThemes: true` in `styles/unistyles.ts` only covers the frames before the provider runs.

`terminal-emulator-runtime.browser.test.ts` does not load `xterm.css`, so `.xterm-screen` geometry is meaningless there. Assert inset through the host's rect against the root's, and assert the fit through `rows * rowHeight <= host height` and rows/cols against an uninset baseline. To assert "written only when changed" on an xterm option, redefine the accessor on `terminal.options` (it is configurable) and count setter calls; do not assert on runtime internals.

## Redesign roles and their derivation

The redesign added color roles on top of `surface0`–`surface4`. Design intent lives in `docs/design.md` §3, §4, §12; this is the implementation contract.

**Signature.** `LightThemeConfig` / `DarkThemeConfig` extend `ThemeRoleOverrides` (`styles/theme.ts`): optional `surfaceWorkspace`, `surfaceChrome`, `surfaceCard`, `surfaceMessage`, `surfaceSidebarHover`, `surfaceSidebarActive`, `surfaceSidebarSelected`, `borderSidebarSelected`, `borderInput`, `shadowComposer`, `insetHighlight`. Both semantic builders spread `deriveThemeRoles(base, overrides)` (module-private), which returns those eleven plus `diffAdditionBackground`, `diffDeletionBackground`, `diffAdditionBar`, `diffDeletionBar` (always derived from the status colors, matching `git/diff-document/palette.ts`).

**Contract.**

| Role | Derived value when the config omits it |
|---|---|
| `surfaceWorkspace` | dark `surface1`, light `surface0` (what the workspace painted before) |
| `surfaceChrome` | `surfaceWorkspace` |
| `surfaceCard` | dark `surface2`, light `surface0` (same as `popover`) |
| `surfaceMessage` | `surface3` (the bubble's old fill) |
| `surfaceSidebarHover` / `Selected` | `surface1` / dark `surface2`, light `surface3`, then separated (below) |
| `surfaceSidebarActive` | hover + 6% `foreground`, separated from hover and selected |
| `borderSidebarSelected` | selected + 12% `foreground`, separated from selected |
| `borderInput` | `border` |
| `shadowComposer` / `insetHighlight` | light `rgba(0, 0, 0, 0.4)` / `transparent`; dark `transparent` / `rgba(255, 255, 255, 0.04)` |

- Only Light and Dark (`lightSemanticColors`, `paseoDarkColors`) pass overrides. Variants and plugin themes pass none, so a plugin never has to ship a new field when the host adds a role.
- Row-state colors are opaque `#rrggbb`. Translucent design values are flattened with `mixHexColor(base, overlay, amount)` (`utils/color.ts`), which accepts `#rgb`, `#rrggbb`, and `#rrggbbaa` (alpha ignored), so plugin palettes cannot crash the build.
- Separation: `ensureDistinctRowColor` keeps a derived row state ≥ 1.05:1 (`hexContrastRatio`) from each neighbor by mixing toward `foreground` in 1% steps. Hover/selected/active/border neighbors: sidebar↔hover, hover↔selected, sidebar↔selected, active↔hover, active↔selected, border↔selected. Pure Black, Catppuccin Latte, Rosé Pine Dawn, and GitHub Light shifted by one to a few steps because of this.

**Shape tokens.** `theme.radius` (`RADIUS`: `sm` 6 … `3xl` 22, `full`) and `theme.controlHeight` (`CONTROL_HEIGHT`: 24 / 28 / 32) sit beside the unchanged `borderRadius` and `control-geometry.ts` heights. Migrated components read the new ones; unmigrated ones keep the old ones so their shape does not move. `applyAppearance` spreads the theme, so both pass through appearance updates untouched.

**Text ramp.** `theme.typeScale` (`TYPE_SCALE`, `TextVariant` in `styles/theme.ts`) is `Record<TextVariant, { fontSize; lineHeight }>` authored at a 14px base. `applyAppearance` rebuilds it from `TYPE_SCALE` (never from the live theme, so repeated applies do not compound) with `round(value * uiBaseFontSize / 14)` for both numbers; it is widened to `number` like `fontSize`. `<Text>` (`components/ui/text.tsx`) is the only reader:

```ts
interface TextProps extends Omit<RNTextProps, "style"> {
  variant?: TextVariant;   // default "body"
  color?: TextColor;       // default "foreground"; the three text tiers + status* + accentBright
  weight?: TextWeight;     // "normal" | "medium" | "semibold"
  style?: StyleProp<TextLayoutStyle>; // TextStyle minus color / fontSize / lineHeight / fontWeight
}
```

`TextLayoutStyle` types those four keys as `never`, so a stylesheet entry that sets any of them fails to typecheck at the call site; opacity, flex, and margins stay allowed. A variant style must spread the token (`micro: { ...theme.typeScale.micro }`), never return the theme object itself.

**Row states.** `components/ui/row.tsx` owns the one state rule for sidebar-surface rows: `getRowBackdrop({ hovered, pressed, selected })` returns `surfaceSidebarActive` > `surfaceSidebarSelected` > `surfaceSidebarHover` > `surfaceSidebar` (pressed wins, then selected, so hover never hides selection), and `getRowSurfaceStyle(state)` returns `[radius.md, that fill (none at rest), selected ? boxShadow inset 1px borderSidebarSelected : null]`. `<Row>` uses both; rows that own their press target (workspace and project rows: `ContextMenuTrigger` + drag) spread `getRowSurfaceStyle` into their own style array and keep `sidebar-row-backdrop.ts`, which layers dragging (`surface2`) on top of `getRowBackdrop`. The selected ring is an inset `boxShadow` because a border would move content and an outline would override the `:focus-visible` ring in `public/index.html`. Native `PressHighlight.highlightStyle` still needs its own `surfaceSidebarActive` entry; it does not read the row style array.

**Knockout fills.** Anything filled with the colour behind it (status-ring frame, project status badge, `<Row>` actions) takes `getSurfaceBackdropFillStyle(backdrop)` from `styles/surface-backdrop-fill.ts`. Adding a `SurfaceBackdrop` name is one entry there; `TrailingActionScrim` is the exception because it needs a colour for an SVG prop, not a style.

**Startup canvas.** The default canvas (`#0a0a0a` / `#fcfcfc`) is repeated where the theme cannot be imported: `packages/desktop/src/window/window-manager.ts` `getWindowBackgroundColor`, `packages/app/public/index.html` (`html, body` + dark media query), and `public/manifest.json`. After mount, `DesktopWindowControlsSync` (`app/_layout.tsx`) pushes `surface0`. Changing the default canvas without these flashes the old color at startup.

**Tests required** for the ramp and rows: `appearance/apply.test.ts` (ramp unchanged at 14, every variant scaled at another size), `components/ui/text.browser.test.tsx` (computed size / line height per variant, every colour and weight against the fixture theme), `components/ui/row.browser.test.tsx` (rest, hover, pressed, selected, selected + hover: fill, ring, title colour, actions opacity / pointer-events). The fixture theme in `test-stubs/react-native-unistyles.ts` carries `typeScale` and the row roles; add a token there when a browser-tested component starts reading it.

**Tests required** for the roles (`styles/theme.test.ts`, run from `packages/app`):
- Default palette: Light / Dark role values against the t3code default palette literals.
- Catalog (every `THEME_OPTIONS` theme plus a dark and a light plugin sample built through `collectPluginThemes`): every role matches a color value; building a plugin twice gives equal themes; `foreground` clears 4.5 (light) / 3 (dark) on canvas, chrome, card, message, sidebar and every row state, and `foregroundMuted` on the canvas; the row-state neighbor pairs above clear 1.05.
- Light status dots clear 3:1 on the resting and hovered sidebar row.
- Changing `surface0` for Dark also moves `e2e/browser/terminal-protocol-query.spec.ts` (OSC 11 reply) and any `toHaveCSS` on row fills (`appearance-theme-picker.spec.ts`).

**Wrong vs correct.**

```ts
// Wrong: hand-tuning a variant for a new role — every plugin theme still lacks it.
export const darkNordTheme = buildDarkTheme(
  buildDarkSemanticColors({ /* ... */ surfaceMessage: "#3b4252" }),
);

// Correct: add the role to ThemeRoleOverrides and give it a derivation in
// deriveThemeRoles; set it by hand only in lightSemanticColors / paseoDarkColors.
```

## Rules from the gotcha list

- A style factory is theme-reactive only where it reads a token; branching on `theme.colorScheme` is not tracked. A page with its own palette (the usage page) puts that palette on the theme as `theme.colors.usage`. See `docs/unistyles.md`.
- Do not materialize styles at module scope (`styles.container` read outside a component); `styles/unistyles-module-scope.test.ts` guards this.
- Dynamic pixel values on web and inline styles go through `styles/unistyles-inline-style.ts` and its platform variants.
- `contentContainerStyle` and other non-`style` props do not get tracked; see the fix patterns in `docs/unistyles.md`.
- Reanimated `Animated.View` with dynamic Unistyles styles crashes; the doc has the safe shape.
- Hidden sheet content and memoized style objects have their own sections there.

## Tokens

Spacing uses the theme scale (`theme.spacing[n]`), never `padding: 20`. Colors come from the palette; the identity color table in `styles/identity-colors.ts` is the documented exception. `fontWeight.medium` is reserved for the structural-label tier (`docs/design.md` §3 and §14). Disabled is opacity, not a color change. Code surfaces share `styles/code-surface.ts` and `styles/syntax-token-styles.ts`; markdown shares `styles/markdown-styles.ts`.

## Web-only styling

Scrollbars are installed once through `styles/install-web-scrollbar-styles.web.ts`. Anything that needs a DOM stylesheet lives in a `.web.ts` file, not behind an `if (isWeb)` in a component.
