# macOS builds are signed with one long-lived self-signed certificate

Squirrel.Mac only installs an update whose signature satisfies the running app's designated requirement. Ad-hoc signatures pin that requirement to the build's cdhash, so no ad-hoc build could ever update to the next one. CI signs every macOS build it publishes with a single self-signed code-signing certificate kept in CI secrets; local builds stay unsigned so the certificate never lives on a dev machine's keychain. The designated requirement then pins the certificate instead of the binary, and updates pass. We chose this over an Apple Developer ID because we don't want to pay the yearly fee for a small internal team. We chose it over replacing Squirrel.Mac with our own installer because we don't want to maintain a security-sensitive updater.

## Consequences

- The certificate is the update identity. If it is lost or replaced, every installed copy stops updating, and each user has to reinstall by hand once. Back it up outside CI.
- The first release signed with it has to be installed by hand, because existing ad-hoc installs cannot validate it.
- There is no Team ID, so `hardenedRuntime` stays off (library validation rejects the bundled Electron Framework) and notarization is impossible. Gatekeeper still asks on first launch.
- Moving to a Developer ID later is possible. It costs one more manual reinstall, for the same reason as above.
