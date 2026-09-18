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

`THEME_OPTIONS` in `styles/theme.ts` is the one catalog: the picker, the settings schema, the Unistyles registration, the swatch table, and `DARK_THEME_NAMES` / `LIGHT_THEME_NAMES` are all derived from it. A new variant is one entry plus one `build*Theme(build*SemanticColors({...}))` call; nothing else lists themes. `group` is `primary` / `dark` / `light` and the picker inserts a separator wherever it changes.

Terminal ANSI colors are per theme only when the config provides `terminalAnsi` (the 14 colored slots) and `terminalSelectionBackground`; a config without them shares `lightTerminalAnsi` / `darkTerminalAnsi` and the rgba selection. `black` / `brightBlack` are never in `terminalAnsi`: they come from `terminalBlack` / `terminalBrightBlack`, and on a palette dark variant they clear 1.5:1 and 2:1 on the terminal background (`terminal-contrast.test.ts` lists the six older dark themes as the exception; a new dark variant is covered without editing the test). `background` / `foreground` / `cursor` are always derived from `surface0` / `foreground`, so they stay pure `#rrggbb` for the daemon bridge above.

"System" is not Unistyles adaptive mode. `appearance/resolve-theme.ts` picks `autoDarkTheme` or `autoLightTheme` from the OS scheme (`hooks/use-color-scheme`) and the provider calls `setAdaptiveThemes(false)` + `setTheme(name)` every time; adaptive mode can only flip between the `light` and `dark` slots, and overwriting those slots would leak into a direct Light / Dark selection. `adaptiveThemes: true` in `styles/unistyles.ts` only covers the frames before the provider runs.

`terminal-emulator-runtime.browser.test.ts` does not load `xterm.css`, so `.xterm-screen` geometry is meaningless there. Assert inset through the host's rect against the root's, and assert the fit through `rows * rowHeight <= host height` and rows/cols against an uninset baseline. To assert "written only when changed" on an xterm option, redefine the accessor on `terminal.options` (it is configurable) and count setter calls; do not assert on runtime internals.

## Rules from the gotcha list

- Do not materialize styles at module scope (`styles.container` read outside a component); `styles/unistyles-module-scope.test.ts` guards this.
- Dynamic pixel values on web and inline styles go through `styles/unistyles-inline-style.ts` and its platform variants.
- `contentContainerStyle` and other non-`style` props do not get tracked; see the fix patterns in `docs/unistyles.md`.
- Reanimated `Animated.View` with dynamic Unistyles styles crashes; the doc has the safe shape.
- Hidden sheet content and memoized style objects have their own sections there.

## Tokens

Spacing uses the theme scale (`theme.spacing[n]`), never `padding: 20`. Colors come from the palette; the identity color table in `styles/identity-colors.ts` is the documented exception. `fontWeight.medium` is reserved for the structural-label tier (`docs/design.md` §3 and §14). Disabled is opacity, not a color change. Code surfaces share `styles/code-surface.ts` and `styles/syntax-token-styles.ts`; markdown shares `styles/markdown-styles.ts`.

## Web-only styling

Scrollbars are installed once through `styles/install-web-scrollbar-styles.web.ts`. Anything that needs a DOM stylesheet lives in a `.web.ts` file, not behind an `if (isWeb)` in a component.
