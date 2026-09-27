# The Osuna rename stops at the desktop app identity

The desktop app now carries its own name, icon, and `appId`. Everything the user never sees keeps its upstream `paseo` spelling: the `paseo://` scheme, the `Paseo` Electron userData directory (pinned explicitly, since `productName` would otherwise move it), `~/.paseo`, the `paseo` CLI command, `PASEO_*`, and `@getpaseo/*`. We keep the old spellings because the packaged renderer loads from `paseo://app` and stores its host list and settings under that origin inside userData. Renaming either one silently wipes that data. The deeper identifiers are also spread across thousands of files for no user-visible gain. We don't rebuild the mobile app: phones use the official Paseo app, which talks to an Osuna daemon through the protocol compatibility contract.

## Considered Options

- Full rename (`chore/rebrand-to-osuna`, PR #2): abandoned. It touched about 2,150 files and required data migration.
- Rename the scheme and migrate renderer storage: Chromium storage does not move cleanly between origins. The benefit is invisible to users.

## Consequences

- `paseo` in a file path, env var, or scheme is intentional. Don't "finish" the rename.
- The new `appId` installs Osuna next to an existing Paseo.app instead of replacing it. Users delete the old app by hand.
