# Design

Tokens — every color, font size, weight, spacing step, radius, icon size — live in `packages/app/src/styles/theme.ts`.

---

## 1. Character

Paseo is minimal, spacious, quiet, confident. Whitespace is deliberate. Nothing crowds, nothing decorates, nothing apologizes. A row, a label, a control. That is the bar.

The app is calm so the user's work is not. Every visual decision serves either _act on this_ or _understand this_ — never _look at this_.

The default Light and Dark themes wear the t3code default palette: a neutral gray canvas, one blue accent (`#1b4ed8` light, `#346bf1` dark), and layers told apart by lightness rather than by shadow. In Dark the sidebar (`#000`) is darker than the canvas (`#0a0a0a`). The Electron window (`packages/desktop/src/window/window-manager.ts`) and `packages/app/public/index.html` paint that canvas before React mounts; change them with the theme, or startup flashes the old color.

Consistency comes from component reuse, not from hand-matching styles across surfaces. A row in the projects list, a row in settings, and a row in a modal are the same component, not three implementations that happen to look alike. When two surfaces do the same semantic thing in two different ways, one of them is wrong.

---

## 2. Component reuse

A semantic element used in three or more places is a primitive. One of a kind is a screen.

Primitives live in `packages/app/src/components/ui/` and `packages/app/src/components/headers/`. Text is `<Text>` (§3); a list row is `<Row>` (§12). Card and row layout live in `packages/app/src/styles/settings.ts`. Section structure lives in `packages/app/src/components/settings/headings/settings-section.tsx`.

A pressable styled to look like a button is wrong; the button is `<Button>` (`packages/app/src/components/ui/button.tsx`). A bare `<Text>` styled to look like a section header is wrong; the section header is `<SettingsSection>` (`packages/app/src/components/settings/headings/settings-section.tsx`). A custom `Modal` for a confirmation is wrong; the confirmation is `confirmDialog` (`packages/app/src/utils/confirm-dialog.ts`), or an `<AdaptiveModalSheet>` when it needs detail (§6). A hand-rolled overflow menu is wrong; the menu is `<DropdownMenu>` (`packages/app/src/components/ui/dropdown-menu.tsx`). A hand-rolled status pill is wrong; the pill is `<StatusBadge>` (`packages/app/src/components/ui/status-badge.tsx`). A circle pinned over a scrolling surface is wrong; the floating action is `<FloatingActionButton>` (`packages/app/src/components/ui/floating-action-button.tsx`), one per surface, and the surface reserves `FLOATING_ACTION_BUTTON_CLEARANCE` below its content so the button never traps the last row.

Before adding a new component, read `components/ui/`. The primitive usually exists.

---

## 3. Hierarchy

Hierarchy is conveyed through weight and color, not size. The distinction between a row's primary line and its secondary line is `foreground` versus `foregroundMuted`.

New and migrated text is `<Text>` (`packages/app/src/components/ui/text.tsx`). `variant` picks a purpose-named step, each with its own line height (`TYPE_SCALE` in `packages/app/src/styles/theme.ts`, `micro` through `display`); `prose` is the body size with a looser line height, for long reading. `color` takes only the three text tiers (`foreground`, `foregroundMuted`, `foregroundExtraMuted`) and the semantic colors (`status*`, `accentBright`). `style` is for layout; overriding the size or line height through it is wrong. List titles and Sidebar items are `label`, row metadata is `caption`. Unmigrated text still sets `fontSize.base` / `fontSize.sm` by hand.

The authored interface ramp uses a 14px base. New native installs default to 15px; web and desktop default to 14px. The Appearance **Interface size** setting is the rendered `fontSize.base` value and scales the rest of the UI ramp proportionally, `theme.typeScale` sizes and line heights included (`packages/app/src/appearance/apply.ts`). Primary readable content has its own `fontSize.content`, which defaults to 16px on native and 15px on web and desktop. It owns message bodies, composer input, Markdown, and PR prose. Controls, navigation, metadata, tool chrome, code, diffs, editors, and terminals stay on their interface or code tokens. **Code size** remains independent.

Weight has three tiers, applied by role:

- **Screen titles** — the title in app chrome — use `<ScreenTitle>` (`packages/app/src/components/headers/screen-title.tsx`), which renders `fontSize.base` at weight `400` on compact and `300` on desktop. The New workspace hero is the only larger product title; it uses `fontSize["2xl"]` (`packages/app/src/screens/new-workspace-screen.tsx`).
- **Structural labels** use `fontWeight.medium`. This applies to section labels above a stack of rows (`packages/app/src/components/agent-list.tsx:519-523`, `packages/app/src/components/keyboard-shortcuts-dialog.tsx:63-67`), form field labels above an input inside a modal (`packages/app/src/components/add-host-modal.tsx:19-23`, `packages/app/src/components/pair-link-modal.tsx:24-28`), the title at the top of a modal/sheet/dialog (`packages/app/src/components/adaptive-modal-sheet.tsx:90-94`, `packages/app/src/components/ui/combobox.tsx:1607-1611`, `packages/app/src/components/welcome-screen.tsx:48-53`), action button labels in tight components such as the sidebar callout actions (`packages/app/src/components/sidebar-callout.tsx:218-221`), and inline data emphasis on dense metadata rows (`packages/app/src/components/git-diff-pane.tsx:2322-2327`, `packages/app/src/components/file-explorer-pane.tsx:1115-1122`).
- **Content** uses `fontWeight.normal`. This applies to settings rows (`packages/app/src/styles/settings.ts`), sidebar primary list-item titles (`packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`, except the `attention` title in §12, `packages/app/src/components/agent-list.tsx:572-578`), `<Button>` text (`packages/app/src/components/ui/button.tsx:80-84`), `<StatusBadge>` text (`packages/app/src/components/ui/status-badge.tsx:56-60`), and `<SidebarCallout>` titles (`packages/app/src/components/sidebar-callout.tsx:175-180`).

The rule, condensed: text that _names_ a surface or a group is `medium`. Text that lives _inside_ a surface or a group is `normal`. Top-of-screen titles are `<ScreenTitle>`, which is lighter still.

Foreground is for the thing being acted on: row titles, section headings, the selected sidebar item. `foregroundMuted` is for context: hints, descriptions, secondary metadata, idle sidebar items, placeholders, status text.

`foregroundExtraMuted` is reserved for passive chrome that must sit behind muted text, such as an always-visible window control. Use the solid token instead of lowering SVG opacity; per-path opacity makes overlapping icon strokes render unevenly. Interactive hover and pressed states return to `foreground`.

Accent is the one CTA per surface. A `<Button variant="default">` filled with `accent` appears at most once on a page. Most pages have zero — settings is mostly toggles and text, the workspace pane is mostly content, the chat composer is the input itself.

Destructive is a color, not a click. Restart-daemon and remove-host are `<Button variant="outline">` in the row trailing slot; the destructive fill only appears in the confirmation's footer (Remove host, `RemoveHostSection` in `packages/app/src/screens/settings/host-page.tsx`). Workspace archive opens a confirm dialog before any red appears (`packages/app/src/components/sidebar-workspace-list.tsx`). Red appears after the user has indicated intent.

Surfaces carry the rest of the hierarchy. The canvas, chrome, card, message bubble, sidebar row states, input border, composer shadow, and dark inset highlight are roles in `ThemeRoleOverrides` (`packages/app/src/styles/theme.ts`); diff row fills and bars, and the overlay roles in §6, sit beside them and are always derived. `deriveThemeRoles` fills every role a theme leaves out from that theme's existing colors: Light and Dark set most of them by hand, and every other built-in theme and every plugin theme sets none. Add a new role there once and never tune a variant by hand — plugin authors do not update their themes when the host adds a role. `styles/theme.test.ts` holds every theme plus a plugin sample to the text-contrast and row-state floors.

---

## 4. Buttons

The button is `<Button>` (`packages/app/src/components/ui/button.tsx`). It has five variants. Each has one job.

`default` is the one primary action on a surface — filled with `accent`. At most one per page. The primary slot inside an `<AdaptiveModalSheet>` and the highlighted action on the welcome screen are the canonical uses.

`secondary` is the paired action when two actions carry equal weight — filled with `surface3`. The component default is `secondary`, which matches its frequency in the codebase.

`outline` is the low-frequency action that lives on a row — transparent with `borderAccent`. Restart, Remove, Update on host detail (`packages/app/src/screens/settings/host-page.tsx:585-594`).

`ghost` is structural and non-committal — no border, no fill. Back arrows, header toggles, "Load more" footers (`packages/app/src/screens/sessions-screen.tsx:54-63`), more-affordances. Ghost is used when the affordance is part of the chrome, not a decision. Hovered `outline` and `ghost` buttons take the `interactionHighlight` fill.

Header and toolbar controls use `interactionHighlight` for hovered, pressed, open, and selected
backgrounds. It is a translucent semantic fill so the same control works over the main surface and
the sidebar. Apply it as `backgroundColor`; setting `opacity` on the control also fades its content.

`destructive` is filled with `destructive`. It only appears inside a confirm, in the dialog's footer. The button on the page is `outline`, even when it opens `confirmDialog` rather than an in-app dialog (Clear browser data, `packages/app/src/desktop/browser/settings/browser-data-section.tsx`).

Sizes: `xs` for ultra-tight inline triggers. `sm` for any button sitting in a row. `md` is the page default. `lg` is reserved for large standalone CTAs.

Sizes are a shared contract across control kinds, defined once in `control-geometry.ts`. From the `md` breakpoint up (desktop, tablet, Electron) the tiers are `theme.controlHeight`: `xs` = 24px with `fontSize.sm` labels, `sm` = 28px, `md`/`lg` = 32px with `fontSize.base`. On a compact layout a thumb drives the control, so it keeps touch heights: 28 / 32 / 44. The split is the same breakpoint as `useIsCompactFormFactor` and the menu row height. Fields (`<FormTextInput>`, `<SelectField>`) take the `sm`/`md` heights. Corners come from `radius`: `xs` 6, `sm`/`md` 8, `lg` 10.

`<SegmentedControl>` (`packages/app/src/components/ui/segmented-control.tsx`) takes the same `xs`/`sm`/`md` sizes — a segmented control next to a `<Button>` of the same size always matches in height, label size, and outer radius. The segments sit in a `surface2` track, 2px in, with corners 2px tighter so they stay concentric, and run one padding step tighter than a button. The selected segment is a `surface3` fill with `foreground` text, not an inverted one — inverting it inside thin chrome puts a white slab in the toolbar. Thin chrome such as the file toolbar uses `xs`; settings rows use `sm`. Never shrink a control's font or padding locally to fit a context — if the context needs a smaller control, the size tier is missing or the wrong one is in use.

`radius` (`sm`–`3xl` = 6 / 8 / 10 / 14 / 18 / 22) is the redesign ladder, and `borderRadius` keeps its old values so unmigrated components keep their shape. A component moves to `radius` when it is migrated; `borderRadius` goes once nothing reads it. Icons default to `iconSize.md` (16); metadata uses `xs` or `sm`. The switch is a 32 × 18 track with a 14pt thumb.

A `<Pressable>` wrapping a `<Text>` is a sixth variant. It is wrong. `<Button>` accepts `style`, `textStyle`, `leftIcon`, `disabled`, `size`, and `variant`.

---

## 5. Borders

Borders group, separate, or rarely emphasize.

A logical block of related rows lives inside a card — one border around the whole group. The card primitive is `settingsStyles.card`; the keyboard-shortcuts dialog uses the same shape inline (`packages/app/src/components/keyboard-shortcuts-dialog.tsx:68-73`). The border defines what belongs together.

Rows after the first inside a card carry `settingsStyles.rowBorder` — a single top border. The first row never has one. The same divider pattern appears in the keyboard-shortcuts dialog rows (`packages/app/src/components/keyboard-shortcuts-dialog.tsx:74-83`). Rows do not need their own background to feel separated.

A list that is itself the page content — sidebar items in `sidebar-workspace-list.tsx`, the workspace list, the agent list (`packages/app/src/components/agent-list.tsx`) — uses spacing and surface, not borders, to separate items. Rows-in-a-card is an interior pattern; lists-as-pages are not.

Pane chrome — the workspace pane header, the file-explorer header, the diff pane header — uses a single bottom border to separate the header from the content (`packages/app/src/components/git-diff-pane.tsx:2328-2331`). One border, no shadow.

`borderAccent` is reserved for the outline button and for a hovered or focused field. A field at rest is outlined in `borderInput` (`controlRest` in `control-geometry.ts`), which only Light and Dark set apart from `border`. Single-thing borders are wrong; a single bordered element is either a card with one row (use the card) or it does not need a border.

---

## 6. Pickers

Five primitives. The pick is determined by option count, the need to search, and how the picker is anchored.

`<DropdownMenu>` is for a small fixed set anchored to a trigger. Theme picker, kebab menus on workspace and project rows (`packages/app/src/components/sidebar-workspace-list.tsx:684-770`), row "more" menus. Items can be async (`status: "pending"`) and can include destructive entries. Under ~10 options where the user knows what they're looking for.

`<Combobox>` is for a large or searchable list. Host switcher in the sidebar footer, model selector in the composer, branch switcher in the workspace header (`packages/app/src/components/branch-switcher.tsx`). The user types to find the option, or the list is long enough to scroll.

`<ContextMenu>` is for right-click and long-press on a target. The row is the trigger; there is no visible affordance. Used for incidental actions on workspace rows in the sidebar (`packages/app/src/components/sidebar-workspace-list.tsx`).

`<AdaptiveModalSheet>` is for a focused task. Multi-field forms (`packages/app/src/components/add-host-modal.tsx`, `packages/app/src/components/pair-link-modal.tsx`, `packages/app/src/components/project-picker-modal.tsx`), confirmations with detail, anything that earns a backdrop. Bottom sheet on compact, centered card on desktop. Raw `Modal` is wrong for any of these.

`<AdaptiveModalSheet>` owns the presentation. Its content inset — the gutter that puts sheet content on the same rails as the sheet header — and compact bottom safe-area padding are the sheet's, not the caller's. A caller declares layout intent through `contentStyle` and never branches on form factor to add its own margins. If a sheet's first snap point is shorter than its header, content, and safe-area clearance, raise that snap point rather than moving the sheet container.

`confirmDialog` is for destructive yes/no and imperative confirmation. Promise-based: `await confirmDialog({ destructive: true, ... })`. Anything where a wrong click loses work. It is the operating system's dialog (`dialog.ask` in Electron, `window.confirm` in a browser, `Alert.alert` on native), so none of the overlay styling below reaches it; a confirmation that needs detail or a risk warning is an `<AdaptiveModalSheet>` with its actions in `footer` (`packages/app/src/screens/settings/host-page.tsx`, Remove host).

Three themes is `DropdownMenu`. Thirty hosts is `Combobox`. A label and a value is `AdaptiveModalSheet`. "Are you sure?" is `confirmDialog`.

Menus and the desktop Combobox popover share one surface (`popoverSurfaceStyle` in `packages/app/src/styles/floating-surface.ts`): corners `radius.lg`, a 1px `border`, the `shadowPopover` drop shadow and, in Dark, the `insetHighlight` top rule. A menu row is 30 tall on desktop and 40 on compact (`MENU_ITEM_HEIGHT`), a chip inset 4 from the edge with `radius.sm` corners; hovered, pressed, and open-submenu rows take `interactionHighlight`, and so does the keyboard-focused row, through `:focus-visible` only: the surface focuses its first row on every open, and a pointer-opened menu would otherwise show two lit rows. A destructive item is `destructive` text, never a filled row. A tooltip uses the same frame at `radius.md`, always opaque.

The desktop `<AdaptiveModalSheet>` card is the dialog: `radius["2xl"]`, a 1px `border`, the `shadowDialog` drop shadow, and a footer strip in `surfaceDialogFooter` under one rule, with its buttons at their own width against the trailing edge. Its scrim is `overlayScrim`, drawn on the dismiss target beside the card, never around it: an ancestor with a backdrop filter becomes the card's backdrop root, and the card's own blur then samples only the scrim.

On web and Electron these surfaces are glass: `surfaceGlass` (the card color at 80%) with `blur(12px) saturate(1.14)` behind it, and the dialog scrim blurs by 4px. On native, `GLASS_SURFACES_ENABLED` (`packages/app/src/styles/glass-support.ts`, with a `.web.ts` twin) is false and the same surfaces are the opaque `surfaceCard`; compact sheets are always opaque. A grain tile at 3.5% covers the web window (`packages/app/src/styles/install-web-surface-grain.web.ts`). It is a single click-through overlay, not the per-surface background t3code bakes it into; if Electron's idle GPU cost rises, move it into the surfaces.

---

## 7. Density and rhythm

Settings detail pages, the projects detail page, and any list+detail content sit inside a centered, max-width 720 column (`packages/app/src/screens/settings-screen.tsx`, `packages/app/src/screens/projects-screen.tsx`). Lines stay readable, the eye does not have to track wide horizontal distances. Form modals carry their own narrower content frame (`packages/app/src/components/add-host-modal.tsx`).

Workspace and chat surfaces use the full width — these are working surfaces, not reading surfaces. The composer carries `MAX_CONTENT_WIDTH` from `packages/app/src/constants/layout.ts` to keep lines readable while letting the workspace pane fill the rest.

Sections sit apart. `<SettingsSection>` owns its own bottom margin; the next thing is wrapped in another `<SettingsSection>`. The agent-list `sectionHeading` carries the same `marginTop`/`marginBottom` rhythm (`packages/app/src/components/agent-list.tsx:511-517`). Adding `marginBottom` to a section is wrong.

A section or group explains itself through the `info` prop on `<SettingsSection>` or `<SettingsGroup>` — an info icon beside the header that opens a tooltip (`packages/app/src/components/settings/headings/settings-info-tip.tsx`). A muted paragraph between the header and the card is wrong: it sits in the section's own gap, so it reads as a second heading rather than as prose belonging to the header. Explanatory copy that describes one row belongs to that row, as `settingsStyles.rowHint` inside the card.

Cards inside a section sit closer than sections. Rows inside a card touch — only the divider separates them. The rhythm is page → spacious; section → spacious; card → tight.

Rows have generous vertical padding: roughly 16px of content plus 16px of vertical padding for settings rows, 8–12px for sidebar list items where many rows must fit. Compressing rows below the established density to fit more on the screen is wrong. Too many rows means more cards or more sections, not smaller rows.

The whitespace is the design.

---

## 8. Alignment

Things align to their glyphs, not to their boxes. A row's leading icon, its title, and the label of the button in its trailing slot sit on the same rails — the ink lines up, not the padding, not the touch target, not the hover background.

Pick the rails from the content, then hold them. A settings card establishes a leading rail at the icon's left edge and a trailing rail at the last glyph's right edge; every row in that card uses the same two. A row whose icon is absent still starts its title on the leading rail. Indentation is a new rail, not an arbitrary offset.

The pressable is bigger than the glyph, and that is fine. Hit areas grow outward from the aligned content — they never move it. A button that looks two pixels off because its padding is asymmetric is misaligned even though its box is correct.

Optical alignment beats arithmetic when a glyph disagrees with its bounding box. Icons with visual weight on one side, chevrons, and single-character labels usually need a small nudge to look centered. Trust the eye, then leave a comment saying the offset is optical.

One row off the rail makes the whole card look unconsidered.

---

## 9. Responsiveness

Compact-first. The small case is designed; the large case adds chrome around it.

The list+detail pattern is canonical and reused across surfaces. The settings shell (`packages/app/src/screens/settings-screen.tsx`) and the projects screen (`packages/app/src/screens/projects-screen.tsx`) implement it identically:

- On compact: full-screen list with `<BackHeader>` at the top. Tapping a row pushes a full-screen detail with its own `<BackHeader>` that returns to the list.
- On desktop: a 320px sidebar on the left holds the list with `surfaceSidebar` background. The content pane on the right holds the selected detail with `<ScreenHeader>`, `<HeaderIconBadge>`, and `<ScreenTitle>`.

The branching is one `useIsCompactFormFactor()` check at the top of the screen component. The list and the detail are the same components in both layouts; only the framing changes.

The workspace screen (`packages/app/src/screens/workspace/workspace-screen.tsx`) follows a different but parallel rule: tabs collapse on compact, panes split on desktop. The sidebar (`packages/app/src/components/left-sidebar.tsx`) is overlaid on compact and pinned on desktop.

On a narrow desktop route, app navigation yields to the rendered content topology when the remaining width cannot preserve its center target: Settings keeps its 320px list + 400px detail split, and a workspace Explorer keeps its current visible width plus a 400px center pane. That is a topology decision at the app container, not a second compact breakpoint. Temporary width clamps are render-only; widening restores the user's saved sidebar widths.

Electron window controls are top-corner obstructions, not a compact-layout condition. Rendered surfaces declare which top corners they physically occupy; only those corners receive clearance. Full-window overlays redeclare both corners. A focused split pane owns both corners; if focus restoration temporarily exposes the full split tree, the split boundary reserves one top strip instead of assigning a control rectangle to an arbitrarily narrow leaf. The 720px desktop breakpoint preserves the default 320px sidebar and target 400px center width when the Explorer is closed; it is product policy, not an obstruction gate.

Windows and Linux controls are fixed window chrome, outside scrolling header content. A tab rail that reaches them ends at their obstruction and shows the shared overflow fade. On macOS, the Explorer toggle occupies a fixed top-right window slot so opening and closing Explorer does not move the pointer target.

A new list+detail feature copies the settings shell. A new workspace-shaped feature copies the workspace shell. Inventing a third shape happens in design review, not in a PR.

---

## 10. Copy and voice

Sentence case. "Pair a device", "Danger zone", "Restart daemon", "Inject Paseo tools", "No sessions yet", "Load more". Proper nouns retain casing — Paseo, Beta, Stable, Local. Title case is wrong.

No trailing periods on row titles, labels, or buttons. No trailing period on a single-clause hint: "What happens when you press Enter while the agent is running" (`packages/app/src/screens/settings-screen.tsx:271-272`). Periods exist inside multi-sentence prose: "Restarts the daemon process. The app will reconnect automatically."

Empty-state strings are short noun phrases or short sentences: "No projects yet", "Select a project", "No sessions yet" (`packages/app/src/screens/sessions-screen.tsx:74-76`), "Host not found".

Buttons are imperative: Save, Cancel, Restart, Remove, Update, Install update, Add host, Load more. In-flight labels are present-participle with a literal three-dot ellipsis: "Saving...", "Restarting...", "Removing...", "Loading...".

Error copy is direct. "Unable to remove host" (`packages/app/src/screens/settings/host-page.tsx:697`), not "Sorry, we couldn't remove the host." Recovery instructions are concrete: "Wait for it to come online before restarting." Errors describe state; they do not editorialize.

Terminology:

- Workspace, never "checkout".
- Host, except where the user-facing concept is the daemon process itself ("Restart daemon").
- Project, not "repo" or "repository".
- Provider, not "model provider".
- Session and agent are distinct: a session is a historical entry in `sessions-screen.tsx`; an agent is a live entity in the workspace.

---

## 11. States

Loading is inline by default. `<LoadingSpinner size={14} color={foregroundMuted} />` sits next to the thing it relates to (`packages/app/src/screens/settings/providers-section.tsx:227-231`). Page-level loading is a centered `<LoadingSpinner size="large">` (`packages/app/src/screens/sessions-screen.tsx:69-72`). Card-level loading is a single short line, not a spinner. In-row dropdown items use `<DropdownMenuItem status="pending" pendingLabel="Removing...">`; the menu item handles its own pending state.

Empty states are short noun phrases. Centered, muted, one or two lines. Sessions screen pairs the empty noun with a single ghost button to navigate back (`packages/app/src/screens/sessions-screen.tsx:74-81`); that pairing is the maximum elaboration. Illustrations and CTAs disguised as empty states are wrong.

Inline errors are a single sentence in `palette.red[300]` `xs`, sitting under the field or inside the card it relates to (`packages/app/src/screens/settings/providers-section.tsx:115-119`).

Page-level alerts — informational notices, success confirmations, warnings, or recoverable errors that need a small visible block on the page — use `<Alert>` (`packages/app/src/components/ui/alert.tsx`). Variants: `default`, `info`, `success`, `warning`, `error`. The chrome is quiet by design: a 1px tinted border, transparent background, a small variant-tinted icon, the title in the variant accent, the description in `foregroundMuted`. `warning` is the risk block instead: no border, a `surfaceWarning` fill, `radius.md` corners. It is the warning a dialog shows before a risky action (the pairing-link warning in `packages/app/src/desktop/components/pair-device-section.tsx`). Actions go in the `children` slot as `<Button variant="outline" size="sm">` — recovery actions are low-frequency and outline keeps them quiet alongside the alert's accent (`packages/app/src/screens/project-settings-screen.tsx`). One `<Alert>` at a time per region.

Sidebar callouts — cross-cutting alerts that apply across the whole app, like worktree setup, Rosetta install, and desktop update available — register through `useSidebarCallouts()` and render in the left sidebar via `<SidebarCallout>` (`packages/app/src/components/sidebar-callout.tsx`). The chrome (top-border-only, full-width action buttons) is tuned for that ~280px column. Canonical sources: `packages/app/src/components/worktree-setup-callout-source.tsx`, `packages/app/src/desktop/updates/rosetta-callout-source.tsx`, `packages/app/src/desktop/updates/update-callout-source.tsx`. Never import `<SidebarCallout>` into a page — that's what `<Alert>` is for.

Imperative errors are `Alert.alert("Error", "Unable to ...")` (the React Native `Alert` API, not this component) for failures that interrupt the flow and have no place on the page.

Disabled state is `opacity: theme.opacity[50]` on the outer pressable. Color changes for disabled state are wrong; a disabled button is the same button, dimmer.

Partial failure (a list mostly fine but one source errored) is a bordered banner above the list, listing each failure in red-300 `xs` (`packages/app/src/screens/projects-screen.tsx:151-159`). The list still renders.

State surfaces at the smallest scope it affects. Field error stays under the field; page error is a banner; flow-stopping error is an `Alert`.

Changing state must not move the layout. A row that grows when its badge arrives, a card that reflows when a count resolves, a list that jumps as data streams in — all wrong. Reserve the space the loaded state will need, so the skeleton, the spinner, and the content occupy the same box. A surface that shifts under the user stops feeling calm.

---

## 12. List rows

The row anatomy is a content column with an optional trailing slot. Inside a card the row is `settingsStyles.row`. A list row is `<Row>` (`packages/app/src/components/ui/row.tsx`): a leading slot, a `label` title with an optional meta line under it, a trailing slot, and hover-revealed actions drawn over the trailing slot, so a kebab never pushes the diff stat aside. Sidebar items are `<Row size="sm">` through `SidebarHeaderRow`. Rows that own their press target — the workspace and project rows, whose press target is a context-menu trigger with drag wiring — keep their markup and paint their states with `getRowSurfaceStyle` from the same module, so every sidebar row shares one state rule.

Row states come from the sidebar row roles: hover `surfaceSidebarHover`, pressed `surfaceSidebarActive`, selected `surfaceSidebarSelected` plus a 1px inset ring in `borderSidebarSelected`. Selection outranks hover, so the selected row still reads as selected under the pointer; pressing outranks both. The ring is an inset `boxShadow`, not a border, so selecting a row does not move its content, and not an outline, so it does not replace the keyboard focus ring. Corners are `radius.md`.

Rows that drill into a detail lead with a chevron in the trailing slot (`ChevronRight`, `iconSize.sm`, `foregroundMuted`). The whole row is the `<Pressable>`. Pair-device row (`packages/app/src/screens/settings/host-page.tsx:644-668`), provider row (`packages/app/src/screens/settings/providers-section.tsx:92-132`), project row in the projects list. Chevron means navigation.

Kebab menus (`<DropdownMenu>` with `<MoreVertical size={14} />` trigger) are for actions on the row, not navigation. Menu position: `align="end"`. Items use `<DropdownMenuItem leading={<Icon size={14} color={foregroundMuted} />} ...>`. Visibility is `isHovered || isNative || isCompact` — hover-revealed on web, always visible on native and compact layouts. On a hovered workspace row the kebab covers the diff stat behind a scrim instead of displacing it (`resolveTrailingActionVisibility` in `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`).

A row may carry both a chevron and a kebab when both navigation and row-level actions apply. Chevron sits at the end; kebab sits before it.

Switches and segmented controls also sit in the trailing slot. A row that both navigates and toggles is a `<Pressable>` with a `<Switch>` in the trailing slot — the switch calls `event.stopPropagation()` so the row press does not fire (`packages/app/src/screens/settings/providers-section.tsx:92-132`). Sidebar items that hold a status dot, a count, and a kebab follow the same rule (`packages/app/src/components/sidebar-workspace-list.tsx`).

Selected state on rows in a desktop list+detail uses `surfaceSidebarHover` as the background (`packages/app/src/screens/projects-screen.tsx`); the agent list still uses `surface2` (`packages/app/src/components/agent-list.tsx`). Both predate `<Row>`. The sidebar row roles are opaque hexes: a row always sits on the sidebar, so the design's translucent fills are flattened with `mixHexColor` and contrast checks can read them. Light's selected fill is gray, not white: white on the `#fafafa` sidebar is 1.04:1.

A workspace row's title is `label` at 76% opacity, lifted to full on hover or selection. A workspace in the `attention` state (finished, not yet read) has a `semibold` title at full strength: it is the one row asking to be looked at.

---

## 13. Status pills and badges

There is exactly one token per status signal — `statusSuccess`, `statusDanger`, `statusWarning`, `statusMerged` — and every status surface uses it: PR state icons, CI check icons and pies, diff stats, file-change icons, status pills, usage bars. A surface does not get a quieter or louder variant because of where it sits. If a dense list feels loud, that is a density or weight problem; fix the density, not the color. The tokens are generated, not hand-picked — see the rule in `packages/app/src/styles/theme.ts` and regenerate rather than nudging one value. The level is set by the densest consumer, the sidebar workspace list.

Status **dots** are the one exception, and they are a family of their own — `statusDotSuccess`, `statusDotDanger`, `statusDotWarning`, `statusDotRunning`, read only by `getStatusDotColor` (`packages/app/src/utils/status-dot-color.ts`). Same hues and the same generation rule, but their own band: 90% of gamut chroma against the status family's 55–60%. A dot is a few points of solid color with no shape to read and no label attached, and the running one pulses, so at the status band's chroma the dots read dimmer than the metadata beside them — backwards, since the dot is the row's state. Lightness is set by hue separation rather than by distance from the surface: at 6pt four dark hues on a light surface all read as one dark blob no matter how much contrast they have. So the light band runs as bright as the contrast floor allows at L=0.62, the last step where all four clear 3:1 against the resting and hovered sidebar row (success on the hovered row binds at 3.01); the dark band sits at L=0.72, where danger turns pink above. All four move together; regenerate the set, never one hue.

Status pills use the status token for text on the shared `surface3` and `border` shell. The neutral shell keeps the signal legible without manufacturing translucent colors outside the theme. The `<StatusBadge>` primitive (`packages/app/src/components/ui/status-badge.tsx`) is canonical; a pill never reaches into `palette`.

Status dots — the small filled circles next to a host or agent name — are `borderRadius.full` filled with the status token. Which token a given agent state maps to is owned by `getStatusDotColor` (`packages/app/src/utils/status-dot-color.ts`); a row, a group header, and a project icon all call it rather than restating the mapping. They sit in the trailing slot of a sidebar row or as a leading marker on a status pill.

A workspace row's leading status slot has one mark per state (`WorkspaceStatusIndicator` in `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`): the running ring for busy and starting up, the alert glyph for needs input, a filled dot for attention and for failed, a faint dot for idle. Running is the only mark that moves. The ring (`packages/app/src/components/status-ring/`) ticks in steps rather than sweeping, so a sidebar full of running agents stays quiet, and holds still whenever the system asks for reduced motion.

Identity badges — the project icon, the sidebar host badge, and the PR-panel participant avatar — do not use the theme palette. They draw from the fixed ten-color identity table in `packages/app/src/styles/identity-colors.ts`, whose hexes are held to one contrast band so a color identifies rather than ranks. Project icons and PR avatars use it as a fill with a white letter — that is `identityColor`, one theme-independent hex per identity. Host badges use it as a _foreground_ on both the glyph and the label, which is a different contrast problem that the fill table cannot solve: no single hex clears 4.5:1 against both a near-white and a dark sidebar. Foregrounds therefore come from `identityForeground(name, colorScheme)`, one set per scheme, hue unchanged. That set is generated on the **status family's** lightness and chroma fraction, because a meta row puts a host badge beside a CI check and a diff stat, and two families at different lightness make the brighter one shout. Change the status band and this one changes with it. A host with no color assigned falls back to `foregroundMuted`. The table is theme-independent by design; do not fork it per theme, and do not add hexes to it without recomputing the band.

New status pills use `<StatusBadge>`. Identity, shortcut, and interactive link badges remain separate because color does not encode status there.

---

## 14. Forbidden

- `fontWeight.medium` on row titles, body text, button labels, badge text, or `<SidebarCallout>` titles. Medium is reserved for the structural-label tier described in §3 — section labels, modal/sheet titles, dense metadata emphasis, and tight action labels. Anything else is `normal`. `<ScreenTitle>` is responsive `400/300` and is never overridden.
- `<Pressable>` wrapping `<Text>` to make a button. `<Button>` exists.
- Bare `<Text>` for a section header inside settings. `<SettingsSection>` exists.
- A muted paragraph between a section header and its card. Section-level explanation is the header's `info` tooltip (§7).
- A "Settings" CTA on a detail page. Detail pages are settings; settings is reached from the sidebar, the host entry, or a row's kebab menu.
- The word "checkout" in UI strings or identifiers. The term is "workspace".
- New color tokens or hardcoded hex outside the palette. The identity color table is the documented exception (§13), not a license.
- Placeholder text dimmed beyond `foregroundMuted`. No extra opacity, no italics, no ghost-text.
- `onHoverIn`/`onHoverOut` driving state outside its own `Pressable`, or on an element with another `Pressable` inside. Hover-revealed UI uses the envelope in [hover.md](hover.md): plain `View` + `onPointerEnter`/`onPointerLeave`, a separate inner `Pressable`, visibility gated with `isHovered || isCompact || isNative`.
- Raw DOM APIs without an `isWeb` guard.
- Spacing values outside the scale. `padding: 20` and `gap: 10` are wrong.
- Color changes for disabled state. Opacity only.
- Destructive actions without a confirmation (`confirmDialog`, or an `<AdaptiveModalSheet>` with the destructive button in its footer). Restart, remove, and future destructive actions are confirmed. Archive workspace is confirmed only when its worktree backing reports uncommitted changes or unpushed commits; otherwise it archives immediately.
- Bespoke status pills. `<StatusBadge>` is the pill primitive.
- Raw `Modal` for a focused task. `<AdaptiveModalSheet>` is the modal primitive.
- Importing `ActivityIndicator` directly. `<LoadingSpinner>` is the loading primitive.

---

## 15. Canonical surfaces by pattern

| Pattern                                             | Reference                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List+detail (compact stack, desktop sidebar+pane)   | `packages/app/src/screens/settings-screen.tsx`, `packages/app/src/screens/projects-screen.tsx`                                                                                                                                                                                                           |
| Detail card+row                                     | `packages/app/src/screens/settings/host-page.tsx`, `packages/app/src/screens/settings/providers-section.tsx`                                                                                                                                                                                             |
| Section grouping inside a card list                 | `packages/app/src/components/settings/headings/settings-section.tsx`                                                                                                                                                                                                                                     |
| Form modal (label + input fields, primary + cancel) | `packages/app/src/components/add-host-modal.tsx`, `packages/app/src/components/pair-link-modal.tsx`, `packages/app/src/components/project-picker-modal.tsx`                                                                                                                                              |
| Destructive confirmation                            | `confirmDialog`; with detail, `<AdaptiveModalSheet>` + `footer` in `packages/app/src/screens/settings/host-page.tsx` (`RemoveHostSection`)                                                                                                                                                               |
| Centered hero / first-run                           | `packages/app/src/components/welcome-screen.tsx`                                                                                                                                                                                                                                                         |
| Sidebar list (workspaces, hosts)                    | `packages/app/src/components/sidebar-workspace-list.tsx`, `packages/app/src/components/left-sidebar.tsx`                                                                                                                                                                                                 |
| Live list of items with sections (agents)           | `packages/app/src/components/agent-list.tsx`                                                                                                                                                                                                                                                             |
| Historical list (sessions)                          | `packages/app/src/screens/sessions-screen.tsx`                                                                                                                                                                                                                                                           |
| Workspace pane (multi-tab, split)                   | `packages/app/src/screens/workspace/workspace-screen.tsx`                                                                                                                                                                                                                                                |
| Composer / message input                            | `packages/app/src/components/composer.tsx`, `packages/app/src/components/message-input.tsx`                                                                                                                                                                                                              |
| Pane chrome with single bottom border               | `packages/app/src/components/git-diff-pane.tsx`, `packages/app/src/components/file-explorer-pane.tsx`, `packages/app/src/components/terminal-pane.tsx`                                                                                                                                                   |
| Page-level alert (info / success / warning / error) | `packages/app/src/components/ui/alert.tsx`, `packages/app/src/screens/project-settings-screen.tsx`                                                                                                                                                                                                       |
| Sidebar callout (cross-cutting alert)               | `packages/app/src/components/sidebar-callout.tsx`, `packages/app/src/contexts/sidebar-callout-context.tsx`, `packages/app/src/components/worktree-setup-callout-source.tsx`, `packages/app/src/desktop/updates/rosetta-callout-source.tsx`, `packages/app/src/desktop/updates/update-callout-source.tsx` |
| Searchable picker                                   | `packages/app/src/components/ui/combobox.tsx`, `packages/app/src/components/branch-switcher.tsx`                                                                                                                                                                                                         |
| Trigger-anchored menu                               | `packages/app/src/components/ui/dropdown-menu.tsx` (used in `sidebar-workspace-list.tsx`, theme picker)                                                                                                                                                                                                  |
| Right-click / long-press menu                       | `packages/app/src/components/ui/context-menu.tsx` (used in `sidebar-workspace-list.tsx`)                                                                                                                                                                                                                 |
| Headers (back, screen, menu)                        | `packages/app/src/components/headers/back-header.tsx`, `screen-header.tsx`, `menu-header.tsx`                                                                                                                                                                                                            |
