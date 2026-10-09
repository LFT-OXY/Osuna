# Logging

The daemon logs with [pino](https://getpino.io). Output goes to `$OSUNA_HOME/daemon.log` (rotated) and, in development, pretty-printed to the terminal. When debugging, read that file first.

## Creating loggers

- `createRootLogger` in `server/logger.ts` builds the one root logger from `resolveLogConfig` (level, format, file). Only bootstrap calls it.
- Every module gets a child with a `module` binding:

  ```ts
  this.logger = options.logger.child({ module: "workspace-git-service" });
  ```

  `server/workspace-git-service.ts`, `server/relay-transport.ts`, and `server/web-ui.ts` all do this. There are 50+ call sites; match them.
- Loggers are **injected**, never imported as a singleton. Constructors and factories take `logger` in their options object (`new AgentStorage(baseDir, logger)`, `createOsunaDaemon(config, logger)`). This is what lets tests pass a silent logger.

## Writing log lines

- Context object first, message second: `logger.info({ agentId, cwd }, "agent started")`. pino merges the object into the JSON line; string interpolation loses that.
- Errors use the `err` key: `logger.error({ err: error }, "Failed to create agent")`. pino's serializer prints the stack.
- Levels: `debug` for per-message or per-tick detail, `info` for lifecycle transitions (started, stopped, connected), `warn` for recoverable surprises, `error` for failures a person should look at. `trace` exists for the terminal and stream pipelines only.
- No `console.log` / `console.error` in daemon code. The six remaining uses are in entrypoints before a logger exists; new code has a logger.

## In tests

- Unit tests: `createTestLogger()` from `src/test-utils/test-logger.ts` returns `pino({ level: "silent" })`. Some suites build the same thing inline with `vi.spyOn` on `info`/`warn`/`error` to assert that a warning was logged (`server/workspace-archive-service.test.ts`); prefer the shared helper unless you assert on log calls.
- Daemon E2E: `createTestOsunaDaemon` wires its own logger; pass `{ level: "warn" }` when you need to see failures from a script (`docs/ad-hoc-daemon-testing.md`).

## Anti-patterns

- A module-level `const logger = pino()` inside a feature file.
- `logger.info(\`agent ${id} started\`)` with no context object.
- Logging the same failure at two layers. Log where you handle it.
- Logging secrets: tokens, relay keys, or file contents. `server/private-files.ts` values never reach a log line.
