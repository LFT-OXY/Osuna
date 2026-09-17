/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  DaemonClient,
  FetchRecentProviderSessionEntry,
} from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));
import { SessionHistorySurface, type SessionHistoryClient } from "@/session-history";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: () => () => null,
}));

type FetchRecentProviderSessions = DaemonClient["fetchRecentProviderSessions"];
type CreateTerminal = DaemonClient["createTerminal"];
type CreateTerminalPayload = Awaited<ReturnType<CreateTerminal>>;

function entry(
  overrides: Partial<FetchRecentProviderSessionEntry>,
): FetchRecentProviderSessionEntry {
  return {
    providerId: "claude",
    providerLabel: "Claude Code",
    providerHandleId: "handle-1",
    cwd: "/repo/app",
    title: "Fix login",
    firstPromptPreview: "fix the login bug",
    lastPromptPreview: "done",
    lastActivityAt: "2026-09-17T10:00:00.000Z",
    ...overrides,
  };
}

function createdTerminal(id: string): CreateTerminalPayload {
  return {
    requestId: "create-terminal",
    terminal: {
      id,
      name: "Fix login",
      cwd: "/repo/app",
      workspaceId: "ws-1",
      activity: null,
    },
    error: null,
  };
}

function renderSurface(
  client: SessionHistoryClient | null,
  options?: { isConnected?: boolean; onTerminalCreated?: (terminalId: string) => void },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onTerminalCreated = options?.onTerminalCreated ?? vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionHistorySurface
        serverId="server-1"
        workspaceId="ws-1"
        workspaceDirectory="/repo/app"
        client={client}
        isConnected={options?.isConnected ?? true}
        onTerminalCreated={onTerminalCreated}
      />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, onTerminalCreated };
}

function createClient(input: {
  fetchRecentProviderSessions?: FetchRecentProviderSessions;
  createTerminal?: CreateTerminal;
}): SessionHistoryClient {
  return {
    fetchRecentProviderSessions:
      input.fetchRecentProviderSessions ??
      (vi.fn(async () => ({
        requestId: "recent",
        entries: [],
      })) as unknown as FetchRecentProviderSessions),
    createTerminal:
      input.createTerminal ??
      (vi.fn(async () => createdTerminal("term-1")) as unknown as CreateTerminal),
  };
}

describe("SessionHistorySurface", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks the daemon for the workspace directory at the protocol limit", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [entry({})],
    })) as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }));

    await screen.findByText("Fix login");
    expect(fetchRecentProviderSessions).toHaveBeenCalledWith({ cwd: "/repo/app", limit: 200 });
  });

  it("lists resumable sessions newest first with the title fallback chain", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [
        entry({
          providerHandleId: "older",
          title: null,
          firstPromptPreview: "older prompt",
          lastActivityAt: "2026-09-16T10:00:00.000Z",
        }),
        entry({
          providerId: "gemini",
          providerLabel: "Gemini",
          providerHandleId: "no-resume",
          title: "Not resumable",
          lastActivityAt: "2026-09-18T10:00:00.000Z",
        }),
        entry({
          providerId: "codex",
          providerLabel: "Codex",
          providerHandleId: "untitled",
          title: null,
          firstPromptPreview: null,
          lastActivityAt: "2026-09-17T12:00:00.000Z",
        }),
        entry({ providerHandleId: "newest", lastActivityAt: "2026-09-17T13:00:00.000Z" }),
      ],
    })) as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }));

    await screen.findByText("Fix login");
    const labels = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Fix login", "Codex", "older prompt"]);
    expect(screen.queryByText("Not resumable")).toBeNull();
  });

  it("opens a terminal running the provider's resume command in the session directory", async () => {
    const createTerminal = vi.fn(async () =>
      createdTerminal("term-9"),
    ) as unknown as CreateTerminal;
    const onTerminalCreated = vi.fn();
    const { queryClient } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({ providerId: "codex", providerLabel: "Codex", cwd: "/repo/worktree" })],
        })) as unknown as FetchRecentProviderSessions,
        createTerminal,
      }),
      { onTerminalCreated },
    );

    fireEvent.click(await screen.findByTestId("session-history-row-codex-handle-1"));

    await waitFor(() => expect(onTerminalCreated).toHaveBeenCalledWith("term-9"));
    expect(createTerminal).toHaveBeenCalledWith("/repo/worktree", "Fix login", undefined, {
      command: "codex",
      args: ["resume", "handle-1"],
      workspaceId: "ws-1",
      viewAttributes: { foreground: "#1a1a1e", background: "#ffffff", cursor: "#1a1a1e" },
    });
    const terminals = queryClient.getQueryData<{ terminals: Array<{ id: string }> }>(
      buildTerminalsQueryKey("server-1", "/repo/app", "ws-1"),
    );
    expect(terminals?.terminals.map((terminal) => terminal.id)).toEqual(["term-9"]);
  });

  it("keeps the list and shows the daemon's reason when the terminal cannot start", async () => {
    const createTerminal = vi.fn(async () => ({
      requestId: "create-terminal",
      terminal: null,
      error: "spawn codex ENOENT",
    })) as unknown as CreateTerminal;
    const { onTerminalCreated } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({})],
        })) as unknown as FetchRecentProviderSessions,
        createTerminal,
      }),
    );

    fireEvent.click(await screen.findByTestId("session-history-row-claude-handle-1"));

    await screen.findByText("spawn codex ENOENT");
    expect(screen.getByTestId("session-history-open-error")).toBeTruthy();
    expect(onTerminalCreated).not.toHaveBeenCalled();
    expect(screen.getByText("Fix login")).toBeTruthy();
  });

  it("shows the empty state when the workspace has no sessions", async () => {
    renderSurface(createClient({}));

    await screen.findByText(i18n.t("panels.sessionHistory.empty.workspace"));
  });

  it("shows the disconnected state without fetching when the host is offline", () => {
    const fetchRecentProviderSessions = vi.fn() as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }), { isConnected: false });

    expect(screen.getByText("Host is not connected")).toBeTruthy();
    expect(fetchRecentProviderSessions).not.toHaveBeenCalled();
  });

  it("offers a retry when listing fails", async () => {
    const fetchRecentProviderSessions = vi
      .fn()
      .mockRejectedValueOnce(new Error("codex app-server unavailable"))
      .mockResolvedValueOnce({
        requestId: "recent",
        entries: [entry({})],
      }) as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }));

    await screen.findByText("codex app-server unavailable");
    fireEvent.click(screen.getByTestId("session-history-retry"));
    await screen.findByText("Fix login");
  });
});
