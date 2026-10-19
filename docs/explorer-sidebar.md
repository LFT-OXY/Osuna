# Explorer sidebar and side pane

The Explorer sidebar and the side pane share panel implementations, but they have different shell
contracts.

| Surface          | Purpose                                        | Lifecycle                                  |
| ---------------- | ---------------------------------------------- | ------------------------------------------ |
| Explorer sidebar | Files, Changes, and Session history navigation | Cmd+E shows or hides the dedicated dock    |
| Side pane        | Ordinary workspace content                     | Created and closed like any workspace pane |

## Panel host contract

Every desktop panel registers its supported `PaneHost` values and presentation. Launchers derive
fixed-target labels and icons from that registration, filter by host, and never substitute one
panel type for another. Tab moves reject unsupported destinations, and placement resolves only to
a compatible pane.

Files, Changes, and Session history are the Explorer defaults: every workspace is born with the
three, Changes focused. Their panel manifests mark them as singletons, so a pane's + menu omits
each while that pane already contains it. Closing one makes its menu item available again. Session
history arrived after layouts were already being saved, so a saved layout gets it once on load and
`explorerSidebarSeededTabKindsByWorkspace` (`packages/app/src/stores/workspace-layout-storage.ts`)
records the offer; a user who closes it does not find it back. Session history cannot leave
Explorer.

Logic map is an Explorer-only singleton but not a default: a workspace that never used logic maps
has no such tab. The first time a conversation in the workspace turns its logic map switch on,
`autoOpenLogicMapTab` (`packages/app/src/stores/workspace-layout-store.ts`) shows Explorer and
selects the tab, and `logicMapTabAutoOpenedByWorkspace` records that, so a closed tab stays closed
on later switch-ons and comes back only from the + menu. Like the defaults, it hides its close
button. Other compatible tabs, including agents, terminals, files, and diffs, can move between
Explorer and main panes.
Keep panel implementations independent of either shell. `WorkspacePanelHost` owns mounting and
retention, while each shell owns its tabs, focus, dragging, resizing, and shortcuts.

## Explorer sidebar

`packages/app/src/workspace-tabs/explorer-sidebar.ts` owns show, hide, toggle, and view selection.
On desktop, the shell is rendered outside the workspace split canvas so it divides the full
workspace, including the header. It has its own persisted width and resize handle. Main-pane splits
never read or modify that width.

`packages/app/src/workspace-tabs/open-supporting-view.ts` owns semantic Changes and pull-request
opens. Compact and wide native layouts select the matching Explorer tab. Desktop Changes opens
follow the shared diff preference. Desktop pull requests use their Main panel, On the side, or
Explorer sidebar setting. Automatic PR discovery follows that preference once per workspace without
interrupting the user's work. Closing the tab opts that workspace out of future automatic opens,
even for a different PR; moving or reordering it remains the user's choice.
Callers request the content and never choose the shell.
The composer Changes pill is a two-stage desktop action: it first reveals Explorer on Changes, then
routes later presses to the working diff through the shared diff preference.

The persisted layout still contains the Explorer pane so tabs survive reloads. The renderer removes
that pane from the workspace split tree and docks it separately. Persisted identifiers retain the
literal `"explorer"` pane id and `explorerPaneIdByWorkspace` key for compatibility.

Explorer uses the shared workspace tab row and ordinary tab context menus. Files, Changes, and
Session history hide their close buttons through the panel manifest; close them from the tab
context menu. Other tabs reveal the close control on hover. The + menu opens compatible panels in
the dock and omits Agent and terminal profiles. Agents and terminals can still be dragged into
Explorer. Bulk-close actions apply only to the dock's tabs. Explorer tabs can be reordered and
dragged between compatible panes, but the dock cannot be split or maximized. Selecting an Explorer
tab does not change workspace focus.

Cmd+E shows or hides Explorer without changing its selected view. Compact layouts use the combined
full-screen Explorer overlay for Changes, Files, pull requests, and Session history, and close it
after a file or a resumed terminal opens. Compact Changes has no tree rail; its overview is the Jump to file action (`packages/app/src/git/jump-to-file/`), a sheet over the same changed-files tree the desktop rail renders.
Wide native layouts without pane splits use the same combined content in a resizable inline dock;
opening a file leaves that dock visible. Both presentations keep their selection in the panel store
and reuse the layout store's per-workspace Explorer width. They do not create a second Explorer
lifecycle.

## Session history

`packages/app/src/session-history/` owns the view: it lists provider sessions through
`fetch_recent_provider_sessions` and resumes one by creating a terminal with the provider's
resume command as `command` and `args` (`packages/app/src/utils/provider-command-templates.ts`).
Providers without a resume template never appear. The new terminal tab opens in the focused
main pane through `openTerminalTabFromSessionHistory`; the Explorer pane never holds focus, so
the same call serves the desktop panel and the compact overlay. Terminology is in
[glossary.md](glossary.md) under **Provider session** and **Session history**.

The listing is directory-backed, keyed by `(serverId, scope, cwds)`, not by workspace. The
scope (`workspace` / `project` / `host`) is one per-device preference in
`packages/app/src/session-history/internal/scope-store.ts`, not a workspace setting: the user
picks how wide to look and that choice follows them across projects. The daemon has no push
event for provider logs, so the query pauses while the app or the panel is hidden and React
Query refetches when either comes back or on the refresh button; search filters the fetched
rows on the client and never reaches the daemon. Outside `workspace` scope each row shows its
directory relative to the project root; Paseo worktrees live under `$PASEO_HOME/worktrees`,
outside the root, so they show in full.

Stock Codex asks Codex for the conversations of every
[Codex model provider](glossary.md), and each Codex row names its own. A thread a custom
provider extending Codex started is listed by both, so the daemon keeps only the custom
provider's row, which resumes it with that provider's settings.

A Codex row's menu offers "Move to another Codex model provider…" when the host advertises
`apiEndpointCliWiring`. The dialog belongs to `session-history/view.tsx`, not the surface, because
`AdaptiveModalSheet` pulls in modules the surface's jsdom test cannot parse. The view also holds
the selection-mode keys, so a finished move can end selection mode. One move works in one
provider's `CODEX_HOME`, so once a row is selected, rows of other providers can't be selected.
When an import fails with `agent_create_failed.errorCode` `codex_model_provider_missing`, the
import error offers the same dialog and hides once the row is listed under another provider. The
Agent page's Unarchive does the same on an `rpc_error` with that `code`
(`components/archived-agent-callout.tsx`); the daemon puts the agent back in the archive when the
resume fails, so the callout remounts and keeps its error in a store, not in component state. The rules for moving
are in [ADR 0011](adr/0011-osuna-moves-codex-conversations-between-providers.md); the backups are in
[data-model.md](data-model.md#directory-layout).

The view asks with `includeImported: true`, so sessions Paseo already owns stay in the list with
their `importedAgentId` and `importedAgentWorkspaceId`. Such a row carries a Paseo badge and
opens that agent through `navigateToAgent` with the workspace id and `pin`, the same call the
History list makes; it never starts a terminal, because a provider session resumed in two
processes writes two logs that cannot see each other. The workspace id travels on the wire
because an archived agent is not in the session store, and without it `navigateToAgent` falls
back to the host-level agent route and drops the pin. Archived agents count as owners too: the
daemon reports the archived record and History's open logic decides what an archived agent
looks like. Both the request field and the `server_info.features.sessionHistory` flag arrived
together, so the view gates once on the flag and shows an update prompt on an older host
instead of listing.

## Side pane

`packages/app/src/workspace-tabs/open-beside.ts` owns content opened beside the user's work. The
layout store remembers one ordinary pane per workspace. The first side open creates a full-height
right split around the workspace root; later side opens reuse it.

Removing a pane clears its remembered id; a later side open creates a new pane. The last visible
ordinary pane stays when its final tab closes and shows the New launcher. An empty workspace does
not automatically create an agent draft tab; choosing Agent opens one. Explorer cannot replace the
workspace canvas, even when visible. Restoring a saved layout enforces the same rule while preserving Explorer and saved
tab content. There is no hidden side-pane lifecycle.

Placement intent still controls existing tabs:

| Mode      | New target                  | Existing target                   |
| --------- | --------------------------- | --------------------------------- |
| `pane`    | opens in the requested pane | moves to the requested pane       |
| `prefer`  | opens in the requested pane | stays where the user placed it    |
| `focused` | opens in the focused pane   | focuses it where it already lives |
| `ambient` | opens in a compatible pane  | focuses it where it already lives |

Explicit **Open to Side** uses `pane`. Implicit opens use `prefer`, so a preference affects only a
new target and never yanks an existing tab out of a user-selected pane.

## Routing preferences

Desktop **Settings → Layout → Open location** has independent Main panel or On the side choices for
Explorer Files, diffs, chat files, files opened from diffs, and subagents. They default to Main
panel. Mobile ignores them.

Pull requests have a three-way open location: Main panel, On the side, or Explorer sidebar. Explorer
sidebar is the default. Compact layouts always open pull requests in Explorer regardless of this
desktop preference.

Panels request an implicit open through the narrow `openPreferredTarget(target, source)` pane
contract. Entry points outside panels use `openPreferredWorkspaceTarget`. Do not branch on a
specific shell inside a panel.
