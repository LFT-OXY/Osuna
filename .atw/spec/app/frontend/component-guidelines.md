# Component Guidelines

`docs/design.md` is the design system: character, hierarchy, buttons, borders, density, states, and the forbidden list. This guide is the component-level mechanics that reviewers check.

## Reuse the primitive

Before writing markup, find the canonical surface in `docs/design.md` §15 and copy its shape. The primitives in `components/ui/`:

| Need                       | Use                                                                                        | Not                                                |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| A button                   | `components/ui/button.tsx`                                                                 | `<Pressable>` wrapping `<Text>`                    |
| A loading state            | `components/ui/loading-spinner.tsx`                                                        | `ActivityIndicator` imported directly              |
| A status pill              | `components/ui/status-badge.tsx`                                                           | A bespoke pill                                     |
| A focused modal task       | `components/adaptive-modal-sheet.tsx`                                                      | Raw `Modal`                                        |
| A page-level alert         | `components/ui/alert.tsx`                                                                  | `Alert.alert()` (a no-op on web) or a console line |
| A destructive confirmation | `utils/confirm-dialog.ts` → `confirmDialog()`                                              | An unguarded action                                |
| A picker                   | `components/ui/combobox.tsx`                                                               | A custom list                                      |
| A trigger-anchored menu    | `components/ui/dropdown-menu.tsx`; right-click/long-press `components/ui/context-menu.tsx` | An ad hoc popover (`docs/menus.md`)                |
| A settings section         | `components/settings/headings/settings-section.tsx`                                        | Bare `<Text>` headers                              |
| A form field               | `components/ui/form-field.tsx` with the model from `docs/forms.md`                         | `useEffect` choreography                           |
| A header                   | `components/headers/back-header.tsx`, `screen-header.tsx`, `menu-header.tsx`               | A hand-rolled bar                                  |

## Fallible actions own their three states

Every user action that can fail renders pending, success, and failure in the same context (`docs/testing.md` "Fallible user actions"). Disable the trigger while pending, show the result or an acknowledgement, keep an actionable error visible until retried or dismissed. `screens/settings/host-page.tsx` and `screens/project-settings-screen.tsx` are references. Eleven files still call `Alert.alert`; do not add a twelfth.

## Hover

Read `docs/hover.md` and copy the workspace row in `components/sidebar-workspace-list.tsx`: a plain `View` with `onPointerEnter` / `onPointerLeave` as the hover envelope, a separate inner `Pressable` for press only, fixed `minHeight` so revealed content does not shift layout. Hover only fires on web, so anything hover-revealed is gated `isHovered || isNative || isCompact` so native and phones always see it.

`onHoverIn` / `onHoverOut` has one legitimate use: a `Pressable` styling itself (`components/ui/button.tsx`), preferably through the render-prop `style={({ hovered }) => …}`. The moment hover state is read by anything else, use the envelope. Never put both handler kinds on one element.

## Platform gates

Import from `constants/platform.ts`: `isWeb` for DOM APIs, `isNative` for native-only APIs, `getIsElectron()` for the desktop bridge, `useIsCompactFormFactor()` from `constants/layout.ts` for layout. Never redefine `Platform.OS === "web"` locally, never touch `document`/`window` without `isWeb`, never use `Platform.OS` to make a layout decision.

## Copy

All user-visible strings go through i18next: `const { t } = useTranslation()` and `t("agentList.dateSections.today")` (`components/agent-list.tsx`). Keys live in `i18n/resources/en.ts` and the other nine locales; add the key to every locale file. The word in UI is "workspace", never "checkout" (`docs/glossary.md`).

## React rules that matter most here

- Components render and dispatch. Transitions live in reducers, stores, or the form model.
- Never define a component inside another component.
- Collection rows do not subscribe to the session store individually; the list owner selects once and passes row models (`docs/coding-standards.md` "React").
- Retained native panels use `RetainedPanel` / `RetainedPanelActivity`, keep a stable sibling order, and gate effects through `useRetainedPanelActive` (`docs/mobile-panels.md`).
- Anchored panels go through the portal and lifecycle gates in `docs/floating-panels.md`; the flash and the Android hit-test bug are both documented there.
- `key` is a stable id, never an index (lint enforces `react/no-array-index-key`).
- JSX never travels through a prop, not even via a local variable (`react-perf/jsx-no-jsx-as-prop`; `components/tree-rail.tsx` documents the same wall). `Alert`'s `description` is typed `ReactNode`, but the lint rule rejects JSX there, so a list of raw lines is `lines.join("\n")`; richer content goes in `children` or a sibling element. The same plugin's `jsx-no-new-function-as-prop` makes every handler passed to a component a `useCallback`, which is the one case where the "only for memoized children" rule in Hooks and Data yields to the linter.

## Forbidden (from `docs/design.md` §14, enforced in review)

`fontWeight.medium` outside the structural-label tier; hardcoded hex or new color tokens; spacing outside the scale (`padding: 20`, `gap: 10`); color changes for disabled state; a muted paragraph under a section header; a "Settings" CTA on a detail page; placeholder text dimmed beyond `foregroundMuted`; raw DOM without `isWeb`; destructive actions without `confirmDialog`.
