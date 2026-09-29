# Inline blocks live in the message text

An **Inline block** is stored and sent as ordinary text in the message: a file mention is `[name](relative/path)`, a directory ends its path with `/`, an agent mention is `[@name](paseo://agent/<provider>)`, and skill blocks are the leading `/name` words. The protocol gets no field for blocks. Sent messages — the bubble and Rewind — parse blocks back out of the text. Unsent state (drafts, queued messages, failed-send restore) keeps text and blocks side by side, so typed text never turns into a block before it is sent. Provider history import only gives text back, so text is the one place a block survives it. codeg and t3code work the same way; codex-host leans on the same link form inside Codex Desktop.

## Considered Options

- An optional structured `blocks` field on the send requests, stored on the timeline `user_message`. Rejected: imported history has no such field, so those bubbles would fall back to plain text, and the daemon would need to store and replay a second copy of every user message's structure.

## Consequences

- The agent sees file references as Markdown links instead of quoted paths.
- The official Paseo phone app shows the link text as written.
- Once sent, text typed in exactly the link form, or a typed leading `/name` for a known skill, shows as a block in the bubble and comes back as one on Rewind.
- The format of these links is now part of saved history. Changing it means old messages stop showing blocks.
