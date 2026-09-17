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
import {
  SessionHistorySurface,
  type SessionHistoryClient,
  type SessionHistoryImportResult,
  type SessionHistoryScope,
} from "@/session-history";
import { resetResumeTerminalsForTests } from "@/session-history/internal/resume-terminals";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: () => () => null,
}));

type FetchRecentProviderSessions = DaemonClient["fetchRecentProviderSessions"];
type CreateTerminal = DaemonClient["createTerminal"];
type CreateTerminalPayload = Awaited<ReturnType<CreateTerminal>>;
type ListTerminals = DaemonClient["listTerminals"];
type ImportAgent = DaemonClient["importAgent"];
type ImportedAgentPayload = Awaited<ReturnType<ImportAgent>>;

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

function listedTerminals(...ids: string[]): Awaited<ReturnType<ListTerminals>> {
  return {
    requestId: "list-terminals",
    cwd: "/repo/app",
    terminals: ids.map((id) => ({
      id,
      name: id,
      cwd: "/repo/app",
      workspaceId: "ws-1",
      activity: null,
    })),
  };
}

function importedAgent(overrides: Partial<ImportedAgentPayload>): ImportedAgentPayload {
  return {
    id: "agent-imported",
    provider: "claude",
    cwd: "/repo/app",
    workspaceId: "ws-1",
    model: null,
    createdAt: "2026-09-17T10:00:00.000Z",
    updatedAt: "2026-09-17T10:00:00.000Z",
    lastUserMessageAt: null,
    status: "idle",
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "Fix login",
    labels: {},
    ...overrides,
  };
}

function renderSurface(
  client: SessionHistoryClient | null,
  options?: {
    isConnected?: boolean;
    onOpenTerminal?: (terminalId: string) => void;
    scope?: SessionHistoryScope;
    onScopeChange?: (scope: SessionHistoryScope) => void;
    projectWorkspaceDirectories?: string[];
    isVisible?: boolean;
    isSupported?: boolean;
    onOpenAgent?: (agentId: string, workspaceId: string | null) => void;
    onCopyResumeCommand?: (command: string) => void;
    onImported?: (result: SessionHistoryImportResult) => void;
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenTerminal = options?.onOpenTerminal ?? vi.fn();
  const onScopeChange = options?.onScopeChange ?? vi.fn();
  const onOpenAgent = options?.onOpenAgent ?? vi.fn();
  const onCopyResumeCommand = options?.onCopyResumeCommand ?? vi.fn();
  const onImported = options?.onImported ?? vi.fn();
  const surface = (isVisible: boolean) => (
    <QueryClientProvider client={queryClient}>
      <SessionHistorySurface
        serverId="server-1"
        workspaceId="ws-1"
        workspaceDirectory="/repo/app"
        projectRootPath="/repo/app"
        projectWorkspaceDirectories={options?.projectWorkspaceDirectories ?? ["/repo/app"]}
        scope={options?.scope ?? "workspace"}
        onScopeChange={onScopeChange}
        client={client}
        isConnected={options?.isConnected ?? true}
        isSupported={options?.isSupported ?? true}
        isVisible={isVisible}
        onOpenTerminal={onOpenTerminal}
        onOpenAgent={onOpenAgent}
        onCopyResumeCommand={onCopyResumeCommand}
        onImported={onImported}
      />
    </QueryClientProvider>
  );
  const view = render(surface(options?.isVisible ?? true));
  return {
    ...view,
    queryClient,
    onOpenTerminal,
    onScopeChange,
    onOpenAgent,
    onCopyResumeCommand,
    onImported,
    setVisible: (isVisible: boolean) => view.rerender(surface(isVisible)),
  };
}

function createClient(input: {
  fetchRecentProviderSessions?: FetchRecentProviderSessions;
  createTerminal?: CreateTerminal;
  listTerminals?: ListTerminals;
  importAgent?: ImportAgent;
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
    listTerminals:
      input.listTerminals ?? (vi.fn(async () => listedTerminals()) as unknown as ListTerminals),
    importAgent:
      input.importAgent ?? (vi.fn(async () => importedAgent({})) as unknown as ImportAgent),
  };
}

describe("SessionHistorySurface", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetResumeTerminalsForTests();
  });

  it("asks the daemon for the workspace directory at the protocol limit", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [entry({})],
    })) as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }));

    await screen.findByText("Fix login");
    expect(fetchRecentProviderSessions).toHaveBeenCalledWith({
      cwd: "/repo/app",
      limit: 200,
      includeImported: true,
    });
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
    const labels = screen
      .getAllByTestId(/^session-history-row-/)
      .map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Fix login", "Codex", "older prompt"]);
    expect(screen.queryByText("Not resumable")).toBeNull();
  });

  it("opens a terminal running the provider's resume command in the session directory", async () => {
    const createTerminal = vi.fn(async () =>
      createdTerminal("term-9"),
    ) as unknown as CreateTerminal;
    const onOpenTerminal = vi.fn();
    const { queryClient } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({ providerId: "codex", providerLabel: "Codex", cwd: "/repo/worktree" })],
        })) as unknown as FetchRecentProviderSessions,
        createTerminal,
      }),
      { onOpenTerminal },
    );

    fireEvent.click(await screen.findByTestId("session-history-row-codex-handle-1"));

    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith("term-9"));
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
    const { onOpenTerminal } = renderSurface(
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
    expect(onOpenTerminal).not.toHaveBeenCalled();
    expect(screen.getByText("Fix login")).toBeTruthy();
  });

  it("marks sessions Paseo owns and opens their agent instead of a terminal", async () => {
    const createTerminal = vi.fn() as unknown as CreateTerminal;
    const onOpenAgent = vi.fn();
    const { onOpenTerminal } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [
            entry({
              providerHandleId: "owned",
              title: "Owned",
              importedAgentId: "agent-7",
              importedAgentWorkspaceId: "ws-9",
            }),
            entry({ providerHandleId: "external", title: "External" }),
          ],
        })) as unknown as FetchRecentProviderSessions,
        createTerminal,
      }),
      { onOpenAgent },
    );

    await screen.findByText("External");
    expect(screen.getAllByText(i18n.t("panels.sessionHistory.row.paseo"))).toHaveLength(1);
    expect(screen.getByTestId("session-history-row-claude-owned").textContent).toContain(
      i18n.t("panels.sessionHistory.row.paseo"),
    );

    fireEvent.click(screen.getByTestId("session-history-row-claude-owned"));

    expect(onOpenAgent).toHaveBeenCalledWith("agent-7", "ws-9");
    expect(createTerminal).not.toHaveBeenCalled();
    expect(onOpenTerminal).not.toHaveBeenCalled();
  });

  it("opens a legacy agent without a workspace through the same callback", async () => {
    const onOpenAgent = vi.fn();
    renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({ providerHandleId: "legacy", importedAgentId: "agent-legacy" })],
        })) as unknown as FetchRecentProviderSessions,
      }),
      { onOpenAgent },
    );

    fireEvent.click(await screen.findByTestId("session-history-row-claude-legacy"));

    expect(onOpenAgent).toHaveBeenCalledWith("agent-legacy", null);
  });

  it("asks for a host update instead of listing when the daemon predates session history", () => {
    const fetchRecentProviderSessions = vi.fn() as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }), { isSupported: false });

    expect(screen.getByTestId("session-history-unsupported").textContent).toBe(
      i18n.t("panels.sessionHistory.updateHost"),
    );
    expect(fetchRecentProviderSessions).not.toHaveBeenCalled();
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

  it("fans out one request per project workspace and merges the answers without duplicates", async () => {
    const fetchRecentProviderSessionsMock = vi.fn(async (options: { cwd?: string }) => ({
      requestId: "recent",
      entries:
        options.cwd === "/repo/app"
          ? [entry({ providerHandleId: "shared" }), entry({ providerHandleId: "root-only" })]
          : [entry({ providerHandleId: "shared", cwd: options.cwd ?? "" })],
    }));
    const fetchRecentProviderSessions =
      fetchRecentProviderSessionsMock as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }), {
      scope: "project",
      projectWorkspaceDirectories: ["/tmp/wt", "/repo/app"],
    });

    await screen.findAllByText("Fix login");
    expect(fetchRecentProviderSessionsMock.mock.calls.map((call) => call[0])).toEqual([
      { cwd: "/repo/app", limit: 200, includeImported: true },
      { cwd: "/tmp/wt", limit: 200, includeImported: true },
    ]);
    expect(screen.getAllByRole("button", { name: "Fix login" })).toHaveLength(2);
  });

  it("asks for the whole host without a directory in host scope", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [entry({})],
    })) as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }), { scope: "host" });

    await screen.findByText("Fix login");
    expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(1);
    expect(fetchRecentProviderSessions).toHaveBeenCalledWith({ limit: 200, includeImported: true });
  });

  it("shows where a session lives relative to the project root outside workspace scope", async () => {
    const entries = [
      entry({ providerHandleId: "root", cwd: "/repo/app" }),
      entry({ providerHandleId: "nested", cwd: "/repo/app/packages/web" }),
      entry({ providerHandleId: "outside", cwd: "/tmp/wt" }),
    ];
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries,
    })) as unknown as FetchRecentProviderSessions;

    const projectView = renderSurface(createClient({ fetchRecentProviderSessions }), {
      scope: "project",
    });
    await screen.findByText("packages/web");
    expect(screen.getByText("/tmp/wt")).toBeTruthy();
    expect(screen.queryByText("/repo/app")).toBeNull();
    projectView.unmount();

    renderSurface(createClient({ fetchRecentProviderSessions }), { scope: "workspace" });
    await screen.findAllByText("Fix login");
    expect(screen.queryByText("packages/web")).toBeNull();
  });

  it("reports the chosen scope to the shell", async () => {
    const onScopeChange = vi.fn();
    renderSurface(createClient({}), { onScopeChange });

    await screen.findByText(i18n.t("panels.sessionHistory.empty.workspace"));
    fireEvent.click(screen.getByTestId("session-history-scope-host"));

    expect(onScopeChange).toHaveBeenCalledWith("host");
  });

  it("filters rows by title and prompt previews without asking the daemon again", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [
        entry({ providerHandleId: "1", title: "Fix login", firstPromptPreview: "auth bug" }),
        entry({ providerHandleId: "2", title: "Refactor", lastPromptPreview: "rename login" }),
        entry({ providerHandleId: "3", title: "Docs", firstPromptPreview: null }),
      ],
    })) as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }));
    await screen.findByText("Docs");

    fireEvent.change(screen.getByTestId("session-history-search"), {
      target: { value: "LOGIN" },
    });
    await waitFor(() => expect(screen.queryByText("Docs")).toBeNull());
    expect(screen.getByText("Fix login")).toBeTruthy();
    expect(screen.getByText("Refactor")).toBeTruthy();

    fireEvent.change(screen.getByTestId("session-history-search"), {
      target: { value: "nothing here" },
    });
    await screen.findByText(i18n.t("panels.sessionHistory.empty.search"));
    expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(1);
  });

  it("keeps the good providers' sessions and names the failed ones", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [entry({})],
      providerErrors: [{ provider: "codex", message: "codex app-server unavailable" }],
    })) as unknown as FetchRecentProviderSessions;

    renderSurface(createClient({ fetchRecentProviderSessions }));

    await screen.findByText("Fix login");
    expect(screen.getByTestId("session-history-provider-errors")).toBeTruthy();
    expect(
      screen.getByText(
        i18n.t("panels.sessionHistory.providerErrors.title", { providers: "codex" }),
      ),
    ).toBeTruthy();
    expect(screen.getByText("codex: codex app-server unavailable")).toBeTruthy();

    fireEvent.click(screen.getByTestId("session-history-provider-errors-toggle"));
    expect(screen.queryByText("codex: codex app-server unavailable")).toBeNull();
  });

  it("refetches on the refresh button and when the panel becomes visible again", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [entry({})],
    })) as unknown as FetchRecentProviderSessions;

    const { setVisible } = renderSurface(createClient({ fetchRecentProviderSessions }));
    await screen.findByText("Fix login");
    expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("session-history-refresh"));
    await waitFor(() => expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(2));

    setVisible(false);
    setVisible(true);
    await waitFor(() => expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Fix login")).toBeTruthy();
  });

  it("waits until the panel is visible before listing", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [entry({})],
    })) as unknown as FetchRecentProviderSessions;

    const { setVisible } = renderSurface(createClient({ fetchRecentProviderSessions }), {
      isVisible: false,
    });
    expect(fetchRecentProviderSessions).not.toHaveBeenCalled();

    setVisible(true);
    await screen.findByText("Fix login");
  });

  it("focuses the terminal it already opened for a session instead of resuming it twice", async () => {
    const createTerminal = vi.fn(async () =>
      createdTerminal("term-9"),
    ) as unknown as CreateTerminal;
    const listTerminals = vi.fn(async () => listedTerminals("term-9")) as unknown as ListTerminals;
    const { onOpenTerminal } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({})],
        })) as unknown as FetchRecentProviderSessions,
        createTerminal,
        listTerminals,
      }),
    );

    fireEvent.click(await screen.findByTestId("session-history-row-claude-handle-1"));
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith("term-9"));
    expect(listTerminals).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("session-history-row-claude-handle-1"));
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledTimes(2));

    expect(listTerminals).toHaveBeenCalledWith("/repo/app", undefined, { workspaceId: "ws-1" });
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(onOpenTerminal).toHaveBeenLastCalledWith("term-9");
  });

  it("focuses a terminal that lives outside the workspace directory by workspace id", async () => {
    const createTerminal = vi.fn<CreateTerminal>(async () => createdTerminal("term-far"));
    // The daemon answers a workspaceId-scoped listing from every directory, so
    // a resume terminal started in another worktree still shows up here.
    const listTerminals = vi.fn(async () =>
      listedTerminals("term-far"),
    ) as unknown as ListTerminals;
    const { onOpenTerminal } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({ cwd: "/tmp/other-worktree" })],
        })) as unknown as FetchRecentProviderSessions,
        createTerminal,
        listTerminals,
      }),
      { scope: "host" },
    );

    fireEvent.click(await screen.findByTestId("session-history-row-claude-handle-1"));
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith("term-far"));
    fireEvent.click(screen.getByTestId("session-history-row-claude-handle-1"));
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledTimes(2));

    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(createTerminal.mock.calls[0]?.[0]).toBe("/tmp/other-worktree");
    expect(listTerminals).toHaveBeenCalledWith("/repo/app", undefined, { workspaceId: "ws-1" });
  });

  it("opens a new terminal when the remembered one is gone from the daemon", async () => {
    const createTerminal = vi
      .fn()
      .mockResolvedValueOnce(createdTerminal("term-9"))
      .mockResolvedValueOnce(createdTerminal("term-10")) as unknown as CreateTerminal;
    const listTerminals = vi.fn(async () => listedTerminals("other")) as unknown as ListTerminals;
    const { onOpenTerminal } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({})],
        })) as unknown as FetchRecentProviderSessions,
        createTerminal,
        listTerminals,
      }),
    );

    fireEvent.click(await screen.findByTestId("session-history-row-claude-handle-1"));
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith("term-9"));
    fireEvent.click(screen.getByTestId("session-history-row-claude-handle-1"));
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith("term-10"));

    expect(createTerminal).toHaveBeenCalledTimes(2);
  });

  it("copies the provider's full resume command from the row menu", async () => {
    const { onCopyResumeCommand } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({ providerId: "codex", providerLabel: "Codex" })],
        })) as unknown as FetchRecentProviderSessions,
      }),
    );

    fireEvent.click(await screen.findByTestId("session-history-kebab-codex:handle-1"));
    fireEvent.click(
      await screen.findByTestId("session-history-menu-copy-resume-command-codex:handle-1"),
    );

    await waitFor(() => expect(onCopyResumeCommand).toHaveBeenCalledWith("codex resume handle-1"));
  });

  it("imports an external session into this workspace from the context menu and relists", async () => {
    const fetchRecentProviderSessions = vi.fn(async () => ({
      requestId: "recent",
      entries: [entry({})],
    })) as unknown as FetchRecentProviderSessions;
    const importAgent = vi.fn(async () =>
      importedAgent({ id: "agent-new", workspaceId: "ws-1" }),
    ) as unknown as ImportAgent;
    const { onImported, onOpenTerminal } = renderSurface(
      createClient({ fetchRecentProviderSessions, importAgent }),
    );

    fireEvent.contextMenu(await screen.findByTestId("session-history-row-claude-handle-1"));
    fireEvent.click(await screen.findByTestId("session-history-menu-import-claude:handle-1"));

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith({
        agentId: "agent-new",
        cwd: "/repo/app",
        workspaceId: "ws-1",
        crossWorkspace: false,
      }),
    );
    expect(importAgent).toHaveBeenCalledWith({
      providerId: "claude",
      providerHandleId: "handle-1",
      cwd: "/repo/app",
      workspaceId: "ws-1",
    });
    expect(onOpenTerminal).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchRecentProviderSessions).toHaveBeenCalledTimes(2));
  });

  it("imports a session from another directory without claiming it for this workspace", async () => {
    const importAgent = vi.fn(async () =>
      importedAgent({ id: "agent-far", cwd: "/tmp/elsewhere", workspaceId: undefined }),
    ) as unknown as ImportAgent;
    const { onImported } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({ cwd: "/tmp/elsewhere" })],
        })) as unknown as FetchRecentProviderSessions,
        importAgent,
      }),
      { scope: "host" },
    );

    fireEvent.click(await screen.findByTestId("session-history-kebab-claude:handle-1"));
    fireEvent.click(await screen.findByTestId("session-history-menu-import-claude:handle-1"));

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith({
        agentId: "agent-far",
        cwd: "/tmp/elsewhere",
        workspaceId: null,
        crossWorkspace: true,
      }),
    );
    expect(importAgent).toHaveBeenCalledWith({
      providerId: "claude",
      providerHandleId: "handle-1",
      cwd: "/tmp/elsewhere",
    });
  });

  it("offers no import for a session Paseo already owns", async () => {
    renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({ importedAgentId: "agent-7", importedAgentWorkspaceId: "ws-9" })],
        })) as unknown as FetchRecentProviderSessions,
      }),
    );

    fireEvent.click(await screen.findByTestId("session-history-kebab-claude:handle-1"));

    await screen.findByTestId("session-history-menu-copy-resume-command-claude:handle-1");
    expect(screen.queryByTestId("session-history-menu-import-claude:handle-1")).toBeNull();
  });

  it("keeps the list and shows the daemon's reason when the import fails", async () => {
    const importAgent = vi.fn(async () => {
      throw new Error("session log is unreadable");
    }) as unknown as ImportAgent;
    const { onImported } = renderSurface(
      createClient({
        fetchRecentProviderSessions: vi.fn(async () => ({
          requestId: "recent",
          entries: [entry({})],
        })) as unknown as FetchRecentProviderSessions,
        importAgent,
      }),
    );

    fireEvent.contextMenu(await screen.findByTestId("session-history-row-claude-handle-1"));
    fireEvent.click(await screen.findByTestId("session-history-menu-import-claude:handle-1"));

    await screen.findByText("session log is unreadable");
    expect(screen.getByTestId("session-history-import-error")).toBeTruthy();
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByText("Fix login")).toBeTruthy();
  });
});
