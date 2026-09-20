import { escapeRegex } from "./regex";

/**
 * Ports that a real daemon listens on and no test may borrow: Osuna's installed
 * (6777) and developer (6778) daemons, plus the upstream Paseo daemon (6767) and
 * its dev daemon (6768) that this fork coexists with on the same machine.
 */
export const RESERVED_DAEMON_PORTS: ReadonlySet<number> = new Set([6777, 6778, 6767, 6768]);

/**
 * Resolves the isolated E2E daemon's port, which Playwright's globalSetup
 * publishes into the environment before any spec runs. Helpers and specs that
 * build daemon WebSocket URLs, route patterns, or host endpoints share this
 * accessor instead of re-reading the env var.
 *
 * The `RESERVED_DAEMON_PORTS` guard is a hard guardrail: those ports manage real
 * agents, and the e2e port is never legitimately one of them, so refusing them
 * here keeps every test off a real daemon.
 */
export function getE2EDaemonPort(): string {
  const port = process.env.E2E_DAEMON_PORT;
  if (!port) {
    throw new Error("E2E_DAEMON_PORT is not set (expected from the Playwright worker fixture).");
  }
  if (RESERVED_DAEMON_PORTS.has(Number(port))) {
    throw new Error(`E2E_DAEMON_PORT must not point at a real daemon (${port}).`);
  }
  return port;
}

/**
 * Playwright `routeWebSocket` matcher for a WebSocket on `port`. Matches the
 * `:<port>` segment at a word boundary, so it catches the URL regardless of
 * host or path. Use this when intercepting connections to an arbitrary port
 * (e.g. blocking an unreachable test host); for the E2E daemon itself, prefer
 * `daemonWsRoutePattern()`.
 */
export function wsRoutePatternForPort(port: string): RegExp {
  return new RegExp(`:${escapeRegex(port)}\\b`);
}

/** `routeWebSocket` matcher for the isolated E2E daemon's WebSocket. */
export function daemonWsRoutePattern(): RegExp {
  return wsRoutePatternForPort(getE2EDaemonPort());
}
