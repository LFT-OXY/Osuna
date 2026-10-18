# Osuna moves Codex conversations between Codex model providers

Codex records the **Codex model provider** each conversation started under, in the conversation file and in its state database, and resumes it only through that provider. A conversation started through a provider that is gone, or through one the user no longer wants, cannot be continued from the right place. Osuna now lets the user move Codex conversations to another Codex model provider: one already in Codex's config, the built-in `openai`, or Osuna's own. This writes to Codex's own conversation files and state database, which no earlier ADR allows: [ADR 0004](0004-api-endpoint-rewrites-cli-config.md) covers only the CLI config files. The design is magpie's (MIT).

The facts behind this are in task `10-16-cli-wiring-web-search`, `research/codex-wiring.md` questions 1, 2 and 9; the decisions are `research/decisions.md` Q11, Q12, Q30 and Q32.

## Rules

- **Only on the user's request.** The user picks one or more Codex conversations in **Session history**, or presses the button offered when a resume fails because its Codex model provider is gone. Osuna never moves a conversation on its own, including when the switch changes.
- **Leave active conversations alone.** A conversation whose file was written in the last minute is not moved, and the result says which ones were skipped.
- **Back up first.** Before any change, Osuna copies each conversation file, compressed twins included, into a backup folder of its own, with a record of the conversation id, the old and new provider, the time, and which copy belongs to which file. The backup is for manual recovery only.
- **Change the provider and nothing else.** In each file, every session-start entry that names a provider gets the new one; every other byte stays. A compressed file is compressed again. Each file is written beside the original, flushed, given back its modification time, and renamed over it. Then the conversation's row in each of Codex's state databases gets the new provider.
- **Roll back a failed file step.** If changing a conversation file fails, the files already changed are restored from the backup. If a state database then refuses the change, the files stay moved, as in magpie, and the result says so and names the backup.
- **Undo is moving it back.** Moving a conversation back to the provider it had restores it, since entries without a provider were never changed.

## Considered Options

- **Never move conversations, and keep every Codex model provider table instead** ([ADR 0010](0010-codex-wiring-and-gateway-caller-recognition.md) keeps Osuna's own). Not enough on its own: conversations started through a table another tool wrote, or one the user deleted, stay out of reach.
- **Move conversations automatically when the switch changes.** Rejected: it rewrites the user's history behind their back, and the user may run the conversation in a terminal at the same moment.
- **Start a new conversation from the old one's history.** Rejected: the user loses the conversation's identity and Codex's own resume.

## Consequences

- Known limit, from magpie: settings-snapshot events inside the conversation file keep naming the old provider. Codex reads the provider from those events when it rebuilds its state database from the files, so a rebuild may undo a move. This is inferred, not observed; ticket 13 checks it against a real Codex in a scratch `CODEX_HOME`, and ticket 30 records the result here.
- Osuna depends on the layout of Codex's conversation files and state database, which Codex does not publish. A Codex release that changes either can break moving, and the backup is the recovery path.
- Backups accumulate in Osuna's folder until the user removes them.
