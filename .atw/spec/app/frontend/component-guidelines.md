# Component Guidelines

`docs/design.md` is the design system: character, hierarchy, buttons, borders, density, states, and the forbidden list. This guide is the component-level mechanics that reviewers check.

## Reuse the primitive

Before writing markup, find the canonical surface in `docs/design.md` §15 and copy its shape. The primitives in `components/ui/`:

| Need                       | Use                                                                                        | Not                                                |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Text                       | `components/ui/text.tsx` (`variant`, `color`, `weight`; see Styling "Text ramp")           | RN `<Text>` with hand-set `fontSize` / `color`     |
| A list row                 | `components/ui/row.tsx` `<Row>`; own press target → `getRowSurfaceStyle`                   | Per-file hover / selected / pressed fills          |
| A button                   | `components/ui/button.tsx`                                                                 | `<Pressable>` wrapping `<Text>`                    |
| A loading state            | `components/ui/loading-spinner.tsx`                                                        | `ActivityIndicator` imported directly              |
| A status pill              | `components/ui/status-badge.tsx`                                                           | A bespoke pill                                     |
| A focused modal task       | `components/adaptive-modal-sheet.tsx`                                                      | Raw `Modal`                                        |
| A page-level alert         | `components/ui/alert.tsx`                                                                  | `Alert.alert()` (a no-op on web) or a console line |
| A destructive confirmation | `utils/confirm-dialog.ts` → `confirmDialog()` (OS dialog); with detail, `<AdaptiveModalSheet>` + `footer` | An unguarded action; a red button on the page      |
| A picker                   | `components/ui/combobox.tsx`                                                               | A custom list                                      |
| A trigger-anchored menu    | `components/ui/dropdown-menu.tsx`; right-click/long-press `components/ui/context-menu.tsx` | An ad hoc popover (`docs/menus.md`)                |
| A settings section         | `components/settings/headings/settings-section.tsx`                                        | Bare `<Text>` headers                              |
| A form field               | `components/ui/form-field.tsx` with the model from `docs/forms.md`                         | `useEffect` choreography                           |
| A header                   | `components/headers/back-header.tsx`, `screen-header.tsx`, `menu-header.tsx`               | A hand-rolled bar                                  |

## Fallible actions own their three states

Every user action that can fail renders pending, success, and failure in the same context (`docs/testing.md` "Fallible user actions"). Disable the trigger while pending, show the result or an acknowledgement, keep an actionable error visible until retried or dismissed. `screens/settings/host-page.tsx` and `screens/project-settings-screen.tsx` are references. Eleven files still call `Alert.alert`; do not add a twelfth.

## Hover

Read `docs/hover.md`. A simple list row is `<Row>` (`components/ui/row.tsx`), which already is the pattern: a plain `View` with `onPointerEnter` / `onPointerLeave` as the hover envelope, a separate inner `Pressable` for press only, fixed `minHeight`, and `renderActions` hidden by `opacity` + `pointerEvents` and drawn over the trailing slot. A row with its own press target copies the workspace row in `components/sidebar-workspace-list.tsx` and paints its states with `getRowSurfaceStyle`. Hover only fires on web, so anything hover-revealed is gated `isHovered || isNative || isCompact` so native and phones always see it. A hover readout that sits outside the envelope — a caption naming the hovered cell — needs the same fixed box: an empty `<Text>` collapses, and the reflow on `pointerleave` swallows the next click aimed anywhere below it (`docs/hover.md` failure mode 2).

A list row that needs a hover kebab **and** a right-click / long-press menu is `SessionHistoryRowItem` in `session-history/index.tsx`: the plain `View` envelope holds `isHovered` and `contextMenuOpen`; `ContextMenuTrigger` is the inner press target (press opens, right click and native long press open the menu); the kebab sits in a fixed-width trailing slot hidden by `opacity: 0` + `pointerEvents="none"`, never unmounted; `useOpenKebabMenuVisibility(isHovered || isNative || isCompact)` keeps it mounted while its menu is up. Both menus render one `…MenuItems` component switched by a `surface: "context" | "dropdown"` prop (`session-history/internal/row-menu.tsx`, the same shape as `components/sidebar/sidebar-workspace-menu.tsx`) so the two cannot drift; an action the row cannot offer (import for a Paseo-owned session) is passed as `null`, not hidden by a boolean.

`onHoverIn` / `onHoverOut` has one legitimate use: a `Pressable` styling itself (`components/ui/button.tsx`), preferably through the render-prop `style={({ hovered }) => …}`. The moment hover state is read by anything else, use the envelope. Never put both handler kinds on one element.

## Platform gates

Import from `constants/platform.ts`: `isWeb` for DOM APIs, `isNative` for native-only APIs, `getIsElectron()` for the desktop bridge, `useIsCompactFormFactor()` from `constants/layout.ts` for layout. Never redefine `Platform.OS === "web"` locally, never touch `document`/`window` without `isWeb`, never use `Platform.OS` to make a layout decision.

## Copy

All user-visible strings go through i18next: `const { t } = useTranslation()` and `t("agentList.dateSections.today")` (`components/agent-list.tsx`). Keys live in `i18n/resources/en.ts` and the other nine locales; add the key to every locale file. The word in UI is "workspace", never "checkout" (`docs/glossary.md`).

`i18n/resources.test.ts` is the contract for a new namespace: every locale carries the same key set, fewer than 25% of a locale's strings may equal English, and each key's `{{placeholders}}` must match English exactly. Those three checks shape how you key things:

- **A pure module never imports i18n or returns English.** It returns a description the component renders: `ScheduleDescription = { key, params? } | { text }` in `utils/schedule-format.ts`, rendered by `renderScheduleDescription(t, desc)`; params may nest another description (`"{{day}} at {{time}}"` with `day` itself a key). `{ text }` is for verbatim values (a raw cron expression, an agent title). The pure tests assert the structure; a second set renders through `i18n.t` in `en` and asserts the exact previous English, which is the guard that a refactor changed no user-visible word.
- **Vary by key, not by interpolated noun.** "Edit schedule" / "Edit heartbeat" is `schedules.row.menu.edit.{schedule,heartbeat}` and the component assembles the key from a `"schedule" | "heartbeat"` identifier. `"Edit {{product}}"` breaks the moment one locale needs an article, a case ending, or the noun capitalized differently, and the placeholder-parity test forbids a locale from dropping the placeholder. Singular/plural is two keys with `{{count}}` (`interval.minuteOne` / `interval.minuteMany`), matching `modelSelector.modelCountPlural`, not i18next plural suffixes.
- **Keys assembled at runtime get an existence test.** `t()` returns the key string when it is missing, so a renamed family fails silently; `utils/schedule-format.test.ts` asserts `i18n.exists()` for every `family.product` and state key the components build.
- **A set you compare translated text against is built by the same function that renders it.** Plugin themes are disambiguated by comparing a contributed name to the built-in theme names (`plugins/themes/index.ts` `collectPluginThemes`), and both the picker rows and that comparison set resolve through `appearance/theme-labels.ts` — one key path, one `t`. Two call sites building the same label independently drift on the next key rename, and the failure is silent: nothing matches, so the feature quietly stops firing. Such a set is also language-scoped by construction — pass it in as an argument and let the pure function stay pure, rather than importing i18n into it; the comparison then follows the user's language for free, and the unit test swaps the set to prove it.

- **English stays byte-identical to what it replaced.** Playwright specs locate controls by English accessible name (`getByLabel("Schedule name")`, `getByRole("button", { name: "Create schedule" })`); the e2e run is the proof the migration changed nothing. When a localized wrapper has nothing to add in English, the English value is the bare placeholder (`schedules.cadence.errors.invalid: "{{detail}}"` wraps the cron library's English reason; zh-CN is `"无效的 cron 表达式：{{detail}}"`).
- **`utils/time.ts` `formatTimeAgo` ("5m ago") is deliberately English** and shared app-wide; localize the prefix around it (`"Created {{ago}}"`), not the value.

## React rules that matter most here

- Components render and dispatch. Transitions live in reducers, stores, or the form model.
- Never define a component inside another component.
- Collection rows do not subscribe to the session store individually; the list owner selects once and passes row models (`docs/coding-standards.md` "React").
- Retained native panels use `RetainedPanel` / `RetainedPanelActivity`, keep a stable sibling order, and gate effects through `useRetainedPanelActive` (`docs/mobile-panels.md`).
- Anchored panels go through the portal and lifecycle gates in `docs/floating-panels.md`; the flash and the Android hit-test bug are both documented there.
- `key` is a stable id, never an index (lint enforces `react/no-array-index-key`). A label repeats where a position does not — seven weekday initials are `M T W T F S S` — so key by a stable id list beside the labels, not by the label text (`components/usage/usage-heatmap-card.tsx`, `WEEKDAY_IDS`).
- JSX never travels through a prop, not even via a local variable (`react-perf/jsx-no-jsx-as-prop`; `components/tree-rail.tsx` documents the same wall). A component that hands its caller a slot takes a render function, not a node: `renderHeaderRight?: () => ReactNode` called as `renderHeaderRight?.()` (`components/usage/usage-card.tsx`), with the caller's function in a `useCallback`. The same slot also breaks import cycles: `AssistantTurnFooter` in `components/message.tsx` takes `renderUsage` so `agent-stream/turn-usage-segment.tsx` can import the font constant back out of `message.tsx` without the two files importing each other. Typing the slot `ReactNode` compiles and then fails lint at every call site. `Alert`'s `description` is typed `ReactNode`, but the lint rule rejects JSX there, so a list of raw lines is `lines.join("\n")`; richer content goes in `children` or a sibling element. The same plugin's `jsx-no-new-function-as-prop` makes every handler passed to a component a `useCallback`, which is the one case where the "only for memoized children" rule in Hooks and Data yields to the linter.

## Forbidden (from `docs/design.md` §14, enforced in review)

`fontWeight.medium` outside the structural-label tier; hardcoded hex or new color tokens; spacing outside the scale (`padding: 20`, `gap: 10`); color changes for disabled state; a muted paragraph under a section header; a "Settings" CTA on a detail page; placeholder text dimmed beyond `foregroundMuted`; raw DOM without `isWeb`; destructive actions without a confirmation (`confirmDialog`, or a sheet whose footer holds the destructive button).
