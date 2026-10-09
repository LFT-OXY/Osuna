---
status: accepted
supersedes: ADR-0002
---

# Osuna detaches from Paseo completely

Osuna is now its own product, not a fork. Every identifier the code exposes takes the Osuna spelling: `osuna` CLI, `~/.osuna`, `OSUNA_*`, `osuna.json`, `osuna://`, `@osuna/*`, the `osuna` MCP server, `osuna-plugin.json`. Version 1.0.0 migrates existing `~/.paseo`, the Electron `Paseo` userData directory, and the renderer storage under the `paseo://app` origin on first start, by moving directories and exporting/importing the origin storage from the main process. The GitHub repository leaves the fork network; the relay, web app, and website run on `*.chinhae.cc`; Hub is removed; the upstream Paseo mobile app is no longer a supported client. We stop merging upstream permanently and keep no upstream reference branch.

ADR 0002 stopped the rename at the desktop identity to avoid touching ~2,150 files and migrating data. That trade-off no longer holds: the owner wants no shared identity with upstream at all, including remote infrastructure, and accepts the one-time migration cost and the loss of upstream merges.

## Considered Options

- Keep ADR 0002 (desktop identity only, upstream identifiers inside): rejected. Remote connectivity still ran through upstream's relay and web app, and the repository stayed a fork.
- Rename without data migration: rejected. Other people run Osuna; silently losing their agent history and host list is not acceptable.
- Keep a read-only `upstream-paseo` branch for cherry-picking: rejected by the owner. Upstream changes are ported by hand from the upstream repository when wanted.

## Consequences

- `paseo` in a path, env var, scheme, or package name is a bug, except in `LICENSE`, `NOTICE`, the README acknowledgement, released `CHANGELOG.md` entries, ADR history, and the migration code that reads the old layout.
- The migration renames `~/.paseo` to `~/.osuna` and leaves a `~/.paseo` symlink (junction on Windows) in place. Persisted workspace paths, git worktree `gitdir` pointers, and agent directory names all embed the old absolute path; the link keeps them valid without rewriting user data, and lets a 0.14.x rollback find its data. The link is user data, not code: removing the migration code does not remove it.
- Upstream plugins and the upstream mobile app do not work with Osuna.
- The next release is 1.0.0. Desktop auto-update keeps working because `appId` and artifact names already carried the Osuna spelling.
- Attribution to Paseo stays in `LICENSE` and `NOTICE` as Apache-2.0 requires.
