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
