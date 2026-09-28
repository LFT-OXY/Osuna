# The command list never starts a process

Opening the command menu must be instant, so the daemon answers `list_commands_request` from data it already holds and never starts a provider process to build the list. That holds for every provider and for drafts. The list merges three sources: the list the provider's running process last reported (for Claude: the init message, `supportedCommands()`, `commands_changed`), cached on disk per provider and `cwd`; a scan of the provider's skill and command directories; and a hard-coded set of built-in commands. Before this, the first `/` on an idle Claude agent started the `claude` CLI and waited 1–3 s for its handshake, and a draft started and closed a whole session.

## Considered Options

- Cache the last list, then refresh it by starting the CLI in the background. Rejected: every agent the user merely types into pays for a process.
- Scan directories only, like t3code and desktop-cc-gui. Rejected: it misses plugin skills, MCP prompts, and CLI built-ins.

## Consequences

- The first open for a provider and `cwd` that never ran shows only scanned skills and built-ins, with a hint to send a message. That gap is deliberate. Don't add a "no cache, so start the CLI" fallback.
