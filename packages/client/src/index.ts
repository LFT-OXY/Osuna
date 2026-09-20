import type { OwnedSubscription } from "./connection/index.js";
export type { OwnedSubscription, SubscriptionObserver } from "./connection/index.js";
import type { DaemonClientConfig } from "./daemon-client.js";
import type { AgentPermissionResponse } from "@osuna/protocol/agent-types";
import type {
  AgentSnapshotPayload,
  CreationSnapshot,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListCommandsResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ProjectListRequestMessage,
  ProjectListResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProviderUsageListResponseMessage,
  ProjectPlacementPayload,
  WorkspaceProjectDescriptorPayload,
  RefreshProvidersSnapshotResponseMessage,
  SendAgentMessageRequest,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
  WorkspaceCreateRequest,
} from "@osuna/protocol/messages";
import { DaemonClient, type CreateAgentRequestOptions } from "./daemon-client.js";
import {
  createTerminalActions,
  type OsunaTerminalActions,
  type OsunaWorkspaceTerminalActions,
} from "./terminals/index.js";
export type {
  OsunaTerminal,
  OsunaTerminalActions,
  OsunaTerminalHandle,
  OsunaTerminalCreateOptions,
  OsunaTerminalListOptions,
  OsunaTerminalListResult,
  OsunaTerminalCaptureOptions,
  OsunaTerminalCaptureResult,
  OsunaWorkspaceTerminalActions,
} from "./terminals/index.js";
import type { PluginTimelineItem } from "@osuna/protocol/agent-types";
import type {
  FetchAgentsEntry,
  FetchAgentsOptions,
  FetchAgentsPageInfo,
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
  WaitForFinishResult,
} from "./daemon-client.js";

/**
 * Coding turns routinely run for minutes, so the handle waits far longer than
 * the transport's own conservative default.
 */
const DEFAULT_WAIT_FOR_FINISH_MS = 10 * 60_000;

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface OsunaLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface OsunaClientConfig {
  capabilities?: DaemonClientConfig["capabilities"];
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: OsunaLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type OsunaWorkspace = WorkspaceDescriptorPayload;
export type OsunaAgent = AgentSnapshotPayload;
export type OsunaAgentListOptions = FetchAgentsOptions;
export type OsunaProject = WorkspaceProjectDescriptorPayload;
export type OsunaProjectListOptions = Omit<ProjectListRequestMessage, "type" | "requestId"> & {
  requestId?: string;
};
export type OsunaProjectListResult = ProjectListResponseMessage["payload"];
export type OsunaProjectUpdate = Extract<
  SessionOutboundMessage,
  { type: "project.update" }
>["payload"];
export type OsunaProjectUpdateHandler = (update: OsunaProjectUpdate) => void;

export interface OsunaAgentListResult {
  subscription?: OwnedSubscription<OsunaAgentListResult>;
  requestId: string;
  subscriptionId?: string | null;
  entries: FetchAgentsEntry[];
  pageInfo: FetchAgentsPageInfo;
}
export type OsunaWorkspaceListOptions = Omit<
  FetchWorkspacesRequestMessage,
  "type" | "requestId"
> & {
  requestId?: string;
};

export interface OsunaWorkspaceListResult {
  subscription?: OwnedSubscription<OsunaWorkspaceListResult>;
  requestId: string;
  subscriptionId?: string | null;
  entries: OsunaWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface OsunaWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export type OsunaWorkspaceCreateOptions = Omit<
  WorkspaceCreateRequest,
  "type" | "requestId" | "agent" | "subscribe"
> & {
  requestId?: string;
  agent?: Omit<
    OsunaAgentCreateOptions,
    "worktree" | "git" | "onEvent" | "idempotencyKey" | "requestId"
  >;
  onEvent?: (snapshot: CreationSnapshot) => void;
};

export interface OsunaWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type OsunaWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type OsunaWorkspaceUpdateHandler = (update: OsunaWorkspaceUpdate) => void;

export interface OsunaWorkspaceHandle {
  readonly id: string;
  readonly projectId: string | null;
  readonly directory: string | null;
  readonly name: string | null;
  readonly status: OsunaWorkspace["status"] | null;
  readonly agents: {
    create(options: OsunaWorkspaceAgentCreateOptions): Promise<OsunaAgentHandle>;
  };
  readonly terminals: OsunaWorkspaceTerminalActions;
  current(): OsunaWorkspace | null;
  refresh(options?: { requestId?: string }): Promise<OsunaWorkspace | null>;
  setTitle(title: string | null, requestId?: string): Promise<{ title: string | null }>;
  archive(requestId?: string): Promise<OsunaWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: OsunaWorkspaceUpdate) => void): () => void;
}

export interface OsunaProjectActions {
  list(options?: OsunaProjectListOptions): Promise<OsunaProjectListResult>;
  subscribe(handler: OsunaProjectUpdateHandler): () => void;
}

export interface OsunaWorkspaceActions {
  list(options: OsunaWorkspaceListOptions & { subscribe: {} }): Promise<
    OsunaWorkspaceListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<OsunaWorkspaceListResult>;
    }
  >;
  list(options?: OsunaWorkspaceListOptions): Promise<OsunaWorkspaceListResult>;
  ref(workspace: string | OsunaWorkspace): OsunaWorkspaceHandle;
  open(
    input: string | OsunaWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<OsunaWorkspaceHandle>;
  create(options: OsunaWorkspaceCreateOptions): Promise<OsunaWorkspaceHandle>;
  archive(
    workspace: string | OsunaWorkspaceHandle,
    requestId?: string,
  ): Promise<OsunaWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: OsunaWorkspaceUpdateHandler): () => void;
}

type OsunaAgentSessionConfig = CreateAgentRequestMessage["config"];
export type OsunaAgentProvider = OsunaAgentSessionConfig["provider"];

export type OsunaProviderFeatureValues = Record<string, unknown>;

export interface OsunaAgentConfig {
  /** Provider and model in `provider/model` format. */
  provider: string;
  modeId?: OsunaAgentSessionConfig["modeId"];
  thinkingOptionId?: OsunaAgentSessionConfig["thinkingOptionId"];
  featureValues?: OsunaProviderFeatureValues;
  /** JSON-safe provider-native settings, validated by the selected provider. */
  options?: OsunaAgentSessionConfig["providerOptions"];
  systemPrompt?: OsunaAgentSessionConfig["systemPrompt"];
  toolPolicy?: OsunaAgentSessionConfig["toolPolicy"];
  mcpServers?: OsunaAgentSessionConfig["mcpServers"];
}

export interface OsunaAgentCreateOptions {
  idempotencyKey?: string;
  agentId?: string;
  onEvent?: (snapshot: CreationSnapshot) => void;
  config: OsunaAgentConfig;
  cwd: string;
  parent?: string | OsunaAgentHandle;
  title?: OsunaAgentSessionConfig["title"];
  env?: CreateAgentRequestMessage["env"];
  prompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  requestId?: string;
  labels?: Record<string, string>;
}

export type OsunaWorkspaceAgentCreateOptions = Omit<OsunaAgentCreateOptions, "cwd">;

export interface OsunaAgentRefetchResult {
  agent: OsunaAgent;
  project: ProjectPlacementPayload | null;
}

export interface OsunaAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export interface OsunaAgentSendOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

export interface OsunaAgentRunOptions extends OsunaAgentSendOptions {
  timeoutMs?: number;
}

export type OsunaAgentRunResult = WaitForFinishResult;
export type OsunaAgentPermissionResponse = AgentPermissionResponse;

export interface OsunaAgentRespondToPermissionOptions {
  requestId: string;
  response: OsunaAgentPermissionResponse;
}

export interface OsunaAgentCommandsOptions {
  requestId?: string;
}

export type OsunaAgentCommandsResult = ListCommandsResponse["payload"];

export type OsunaAgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

export type OsunaAgentStream = Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"];

export type OsunaAgentUpdateHandler = (update: OsunaAgentUpdate) => void;

export type OsunaAgentTimelineEvent =
  | OsunaAgentStream
  | {
      agentId: string;
      event: { type: "replacement"; epoch: string };
    }
  | {
      agentId: string;
      subscriptionId: string;
      event: { type: "subscription_restored" };
    }
  | { agentId: string; event: { type: "error"; error: string } };

export type OsunaAgentTimelineSubscription = ReturnType<DaemonClient["subscribeAgentTimeline"]>;

export interface OsunaAgentTimelineHandle {
  append(item: Omit<PluginTimelineItem, "pluginId">): Promise<{ seq: number; epoch: string }>;
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle is updated to
   * that value.
   */
  refetch(options?: OsunaAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Delivers live events only. After reconnect, subscription_restored precedes
   * subsequent updates. History may have been missed; use refetch() to request
   * the range you need. No history is fetched automatically. A replacement event
   * invalidates the previous epoch. Subscription errors release this observation.
   * Await the returned unsubscribe function's `ready` promise before starting
   * work that must be observed. It rejects if establishment fails.
   */
  subscribe(handler: (event: OsunaAgentTimelineEvent) => void): OsunaAgentTimelineSubscription;
}

export interface OsunaAgentHandle {
  readonly id: string;
  /**
   * `workspaceId` through `archivedAt` mirror the last snapshot this handle
   * observed. A handle from `ref()` reads `null` for all of them until
   * `refresh()`, `run()`, `waitForFinish()`, a timeline refetch, or
   * `subscribe()` delivers a snapshot. Optional snapshot values also read as
   * `null`; use `current()` when you need to distinguish those states.
   */
  readonly workspaceId: string | null;
  readonly cwd: string | null;
  readonly status: OsunaAgent["status"] | null;
  readonly capabilities: OsunaAgent["capabilities"] | null;
  readonly availableModes: OsunaAgent["availableModes"] | null;
  readonly pendingPermissions: OsunaAgent["pendingPermissions"] | null;
  readonly activeTurn: NonNullable<OsunaAgent["activeTurn"]> | null;
  readonly lastUsage: NonNullable<OsunaAgent["lastUsage"]> | null;
  readonly lastError: NonNullable<OsunaAgent["lastError"]> | null;
  readonly features: NonNullable<OsunaAgent["features"]> | null;
  readonly runtimeInfo: NonNullable<OsunaAgent["runtimeInfo"]> | null;
  readonly archivedAt: NonNullable<OsunaAgent["archivedAt"]> | null;
  readonly timeline: OsunaAgentTimelineHandle;
  current(): OsunaAgent | null;
  refresh(requestId?: string): Promise<OsunaAgentRefetchResult | null>;
  send(text: string, options?: OsunaAgentSendOptions): Promise<void>;
  respondToPermission(options: OsunaAgentRespondToPermissionOptions): Promise<void>;
  /** Sends a prompt and resolves when that turn finishes or needs attention. */
  run(text: string, options?: OsunaAgentRunOptions): Promise<OsunaAgentRunResult>;
  /** Waits for the current turn, including one started with `prompt`. */
  waitForFinish(timeoutMs?: number): Promise<OsunaAgentRunResult>;
  /**
   * Asks the running session for the slash commands and skills it actually
   * loaded. Providers answer from the live session, so this sees built-in and
   * bundled entries that no directory scan can find. The payload carries its own
   * `error` string; a provider that cannot answer reports it there rather than
   * rejecting.
   */
  commands(options?: OsunaAgentCommandsOptions): Promise<OsunaAgentCommandsResult>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: OsunaAgentUpdate) => void): () => void;
}

export interface OsunaAgentActions {
  list(options: OsunaAgentListOptions & { subscribe: {} }): Promise<
    OsunaAgentListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<OsunaAgentListResult>;
    }
  >;
  list(options?: OsunaAgentListOptions): Promise<OsunaAgentListResult>;
  ref(agent: string | OsunaAgent): OsunaAgentHandle;
  create(options: OsunaAgentCreateOptions): Promise<OsunaAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: OsunaAgentUpdateHandler): () => void;
}

export type OsunaProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type OsunaProviderModesResult = ListProviderModesResponseMessage["payload"];
type OsunaProviderFeaturesDraft = ListProviderFeaturesRequestMessage["draftConfig"];
export interface OsunaProviderFeaturesInput extends Omit<
  OsunaProviderFeaturesDraft,
  "provider" | "model"
> {
  /** Provider and model in `provider/model` format. */
  provider: string;
}
export type OsunaProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type OsunaProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type OsunaProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type OsunaProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type OsunaProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type OsunaProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];
export type OsunaProviderUsageResult = ProviderUsageListResponseMessage["payload"];
export interface OsunaProviderUsageOptions {
  requestId?: string;
}

export interface OsunaProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface OsunaProviderRefreshOptions {
  cwd?: string;
  providers?: OsunaAgentProvider[];
  requestId?: string;
}

export interface OsunaProviderWaitOptions extends OsunaProviderListOptions {
  timeoutMs?: number;
}

export interface OsunaProviderActions {
  listModels(
    provider: OsunaAgentProvider,
    options?: OsunaProviderListOptions,
  ): Promise<OsunaProviderModelsResult>;
  listModes(
    provider: OsunaAgentProvider,
    options?: OsunaProviderListOptions,
  ): Promise<OsunaProviderModesResult>;
  listFeatures(
    draftConfig: OsunaProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<OsunaProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<OsunaProviderAvailabilityResult>;
  snapshot(options?: OsunaProviderListOptions): Promise<OsunaProviderSnapshotResult>;
  /** Resolves after the daemon's lazy provider discovery has finished. */
  waitForReady(options?: OsunaProviderWaitOptions): Promise<OsunaProviderSnapshotResult>;
  refresh(options?: OsunaProviderRefreshOptions): Promise<OsunaProviderRefreshResult>;
  diagnostic(
    provider: OsunaAgentProvider,
    options?: { requestId?: string },
  ): Promise<OsunaProviderDiagnosticResult>;
  listUsage(options?: OsunaProviderUsageOptions): Promise<OsunaProviderUsageResult>;
  subscribe(handler: (update: OsunaProviderSnapshotUpdate) => void): () => void;
}

export interface OsunaConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface OsunaApi {
  dispose(): Promise<void>;
  observeEvents: DaemonClient["observeEvents"];
  readonly terminals: OsunaTerminalActions;
  readonly workspaces: OsunaWorkspaceActions;
  readonly projects: OsunaProjectActions;
  readonly agents: OsunaAgentActions;
  readonly providers: OsunaProviderActions;
  readonly config: OsunaConfigActions;
}

export interface OsunaClient extends OsunaApi {
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createOsunaClient(config: OsunaClientConfig): OsunaClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const api = createOsunaApi(daemonClient);
  return {
    ...api,
    connect: () => daemonClient.connect(),
    close: async () => {
      try {
        await api.dispose();
      } finally {
        await daemonClient.close();
      }
    },
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

function toDaemonAgentCreateOptions(
  options: OsunaAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
): CreateAgentRequestOptions {
  const { config: agentConfig, cwd, parent, title, prompt, ...requestOptions } = options;
  const { provider: providerModel, options: providerOptions, ...runtimeConfig } = agentConfig;
  const { provider, model } = parseProviderModel(providerModel);
  return {
    ...requestOptions,
    config: {
      ...runtimeConfig,
      provider,
      model,
      cwd: placement?.cwd ?? cwd,
      ...(title !== undefined ? { title } : {}),
      ...(providerOptions !== undefined ? { providerOptions } : {}),
    },
    ...(placement ? { workspaceId: placement.workspaceId } : {}),
    ...(parent ? { callerAgentId: resolveAgentId(parent) } : {}),
    ...(prompt !== undefined ? { initialPrompt: prompt } : {}),
  };
}

export function createOsunaApi(
  daemonClient: DaemonClient,
  scopeOptions?: { signal?: AbortSignal },
): OsunaApi {
  const handles = new Set<{ release(): Promise<void> }>();
  const agentListeners = new Set<OsunaAgentUpdateHandler>();
  const workspaceListeners = new Set<OsunaWorkspaceUpdateHandler>();
  const lifetime = new AbortController();
  const own = <T extends { release(): Promise<void> }>(create: () => T): T => {
    if (lifetime.signal.aborted) throw new Error("Osuna API is disposed");
    const handle = create();
    handles.add(handle);
    const release = handle.release.bind(handle);
    handle.release = async () => {
      await release();
      handles.delete(handle);
    };
    return handle;
  };
  const listenAgents = (handler: OsunaAgentUpdateHandler) => {
    if (lifetime.signal.aborted) throw new Error("Osuna API is disposed");
    agentListeners.add(handler);
    return () => {
      agentListeners.delete(handler);
    };
  };
  const listenWorkspaces = (handler: OsunaWorkspaceUpdateHandler) => {
    if (lifetime.signal.aborted) throw new Error("Osuna API is disposed");
    workspaceListeners.add(handler);
    return () => {
      workspaceListeners.delete(handler);
    };
  };
  const createAgentHandle = createAgentHandleFactory(
    daemonClient,
    listenAgents,
    (agentId, handler) => own(() => daemonClient.subscribeAgentTimeline(agentId, handler)),
  );
  const createAgent = async (
    options: OsunaAgentCreateOptions,
    placement?: { workspaceId: string; cwd: string },
  ) => {
    const agent = await daemonClient.createAgent(toDaemonAgentCreateOptions(options, placement));
    return createAgentHandle(agent);
  };
  const terminals = createTerminalActions(daemonClient, async (workspaceId) => {
    const workspace = await createWorkspaceHandle(workspaceId).refresh();
    if (!workspace?.workspaceDirectory) {
      throw new Error(`Workspace ${workspaceId} is not active or has no available directory`);
    }
    return workspace.workspaceDirectory;
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(
    daemonClient,
    createAgent,
    terminals,
    listenWorkspaces,
  );

  let disposal: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    lifetime.abort();
    scopeOptions?.signal?.removeEventListener("abort", abort);
    agentListeners.clear();
    workspaceListeners.clear();
    disposal = Promise.allSettled([...handles].map((handle) => handle.release())).then(
      (results) => {
        handles.clear();
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.length)
          throw new AggregateError(failures, "Failed to release API subscriptions");
        return undefined;
      },
    );
    return disposal;
  };
  const abort = () => {
    void dispose().catch((error) => console.error("API subscription cleanup failed", error));
  };
  if (scopeOptions?.signal?.aborted) abort();
  else scopeOptions?.signal?.addEventListener("abort", abort, { once: true });

  const observeEvents: DaemonClient["observeEvents"] = (events, options) =>
    own(() => daemonClient.observeEvents(events, options));

  const subscribeEvent = (
    event: "project.update" | "providers_snapshot_update",
    update: (message: SessionOutboundMessage) => void,
  ): (() => void) => {
    const observation = observeEvents([event]);
    observation.subscribe({ snapshot: () => {}, update });
    return () => {
      void observation
        .release()
        .catch((error) => console.error("Event subscription cleanup failed", error));
    };
  };

  function listWorkspaces(options: OsunaWorkspaceListOptions & { subscribe: {} }): Promise<
    OsunaWorkspaceListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<OsunaWorkspaceListResult>;
    }
  >;
  function listWorkspaces(options?: OsunaWorkspaceListOptions): Promise<OsunaWorkspaceListResult>;
  async function listWorkspaces(
    options?: OsunaWorkspaceListOptions,
  ): Promise<OsunaWorkspaceListResult> {
    if (!options?.subscribe) return daemonClient.fetchWorkspaces(options);
    if (options.subscribe.subscriptionId !== undefined)
      throw new Error("Subscription IDs are assigned by the host");
    const subscription = own(() => daemonClient.observeWorkspaces(options));
    subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "workspace_update")
          for (const listener of workspaceListeners) listener(message.payload);
      },
    });
    return { ...(await subscription.ready), subscription };
  }

  function listAgents(options: OsunaAgentListOptions & { subscribe: {} }): Promise<
    OsunaAgentListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<OsunaAgentListResult>;
    }
  >;
  function listAgents(options?: OsunaAgentListOptions): Promise<OsunaAgentListResult>;
  async function listAgents(options?: OsunaAgentListOptions): Promise<OsunaAgentListResult> {
    if (!options?.subscribe) return daemonClient.fetchAgents(options);
    if (options.subscribe.subscriptionId !== undefined)
      throw new Error("Subscription IDs are assigned by the host");
    const subscription = own(() => daemonClient.observeAgents(options));
    subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "agent_update")
          for (const listener of agentListeners) listener(message.payload);
      },
    });
    return { ...(await subscription.ready), subscription };
  }

  return {
    dispose,
    observeEvents,
    terminals,
    projects: {
      list: (options) => daemonClient.listProjects(options),
      subscribe: (handler) => {
        return subscribeEvent("project.update", (message) => {
          if (message.type === "project.update") handler(message.payload);
        });
      },
    },
    workspaces: {
      list: listWorkspaces,
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: async ({ requestId, agent, ...options }) => {
        const result = await daemonClient.createWorkspace(
          { ...options, ...(agent ? { agent: toDaemonAgentCreateOptions(agent) } : {}) },
          requestId,
        );
        if (result.error || !result.workspace) {
          throw new Error(result.error ?? "The daemon did not create a workspace");
        }
        return createWorkspaceHandle(result.workspace);
      },
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: listenWorkspaces,
    },
    agents: {
      list: listAgents,
      ref: (agent) => createAgentHandle(agent),
      create: (options) => createAgent(options),
      subscribe: listenAgents,
    },
    providers: {
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: ({ provider: providerModel, ...draftConfig }, options) => {
        const { provider, model } = parseProviderModel(providerModel);
        return daemonClient.listProviderFeatures({ ...draftConfig, provider, model }, options);
      },
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      waitForReady: (options) =>
        waitForProvidersReady(
          daemonClient,
          observeEvents(["providers_snapshot_update"]),
          lifetime.signal,
          options,
        ),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      listUsage: (options) => listProviderUsage(daemonClient, options),
      subscribe: (handler) => {
        return subscribeEvent("providers_snapshot_update", (message) => {
          if (message.type === "providers_snapshot_update") handler(message.payload);
        });
      },
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
  };
}

type WorkspaceHandleFactory = (workspace: string | OsunaWorkspace) => OsunaWorkspaceHandle;
type AgentHandleFactory = (agent: string | OsunaAgent) => OsunaAgentHandle;
type CreateAgent = (
  options: OsunaAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
) => Promise<OsunaAgentHandle>;

function createWorkspaceHandleFactory(
  daemonClient: DaemonClient,
  createAgent: CreateAgent,
  terminals: OsunaTerminalActions,
  listen: (handler: OsunaWorkspaceUpdateHandler) => () => void,
): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let current = typeof workspace === "string" ? null : workspace;

    const refresh = async (options?: { requestId?: string }) => {
      let cursor: string | undefined;
      let requestId = options?.requestId;
      do {
        const result = await daemonClient.fetchWorkspaces({
          requestId,
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        const match = result.entries.find((entry) => entry.id === id);
        if (match) {
          current = match;
          return current;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
        requestId = undefined;
      } while (cursor);
      current = null;
      return current;
    };

    return {
      id,
      get projectId() {
        return current?.projectId ?? null;
      },
      get directory() {
        return current?.workspaceDirectory ?? null;
      },
      get name() {
        return current?.name ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      agents: {
        create: async (options) => {
          const snapshot = current ?? (await refresh());
          if (!snapshot?.workspaceDirectory) {
            throw new Error(`Workspace ${id} has no available directory`);
          }
          return createAgent(
            { ...options, cwd: snapshot.workspaceDirectory },
            { workspaceId: id, cwd: snapshot.workspaceDirectory },
          );
        },
      },
      terminals: {
        create: (options) => terminals.create({ ...options, workspaceId: id }),
        list: (options) => terminals.list({ ...options, workspaceId: id }),
      },
      current: () => current,
      refresh,
      setTitle: (title, requestId) => daemonClient.setWorkspaceTitle(id, title, requestId),
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (current) {
          current = { ...current, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        listen((update) => {
          if (update.kind === "upsert" && update.workspace.id === id) {
            current = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(
  daemonClient: DaemonClient,
  listen: (handler: OsunaAgentUpdateHandler) => () => void,
  subscribeTimeline: DaemonClient["subscribeAgentTimeline"],
): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let current = typeof agent === "string" ? null : agent;

    const handle: OsunaAgentHandle = {
      id,
      timeline: {
        append: (item) => daemonClient.appendAgentTimelineItem(id, item),
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            current = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          subscribeTimeline(id, (message) => {
            switch (message.type) {
              case "agent_stream":
                return handler(message.payload);
              case "agent.timeline.subscription_restored":
                return handler({
                  agentId: id,
                  subscriptionId: message.payload.subscriptionId,
                  event: { type: "subscription_restored" },
                });
              case "agent.timeline.error":
                return handler({
                  agentId: id,
                  event: { type: "error", error: message.payload.error },
                });
              case "agent.timeline.replacement":
                return handler({
                  agentId: id,
                  event: { type: "replacement", epoch: message.payload.epoch },
                });
            }
          }),
      },
      get workspaceId() {
        return current?.workspaceId ?? null;
      },
      get cwd() {
        return current?.cwd ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      get capabilities() {
        return current?.capabilities ?? null;
      },
      get availableModes() {
        return current?.availableModes ?? null;
      },
      get pendingPermissions() {
        return current?.pendingPermissions ?? null;
      },
      get activeTurn() {
        return current?.activeTurn ?? null;
      },
      get lastUsage() {
        return current?.lastUsage ?? null;
      },
      get lastError() {
        return current?.lastError ?? null;
      },
      get features() {
        return current?.features ?? null;
      },
      get runtimeInfo() {
        return current?.runtimeInfo ?? null;
      },
      get archivedAt() {
        return current?.archivedAt ?? null;
      },
      current: () => current,
      refresh: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        current = result?.agent ?? null;
        return result;
      },
      send: async (text, options) => {
        await daemonClient.sendAgentMessage(id, text, options);
      },
      respondToPermission: async ({ requestId, response }) => {
        await daemonClient.respondToPermission(id, requestId, response);
      },
      run: async (text, options) => {
        const { timeoutMs, ...sendOptions } = options ?? {};
        await daemonClient.sendAgentMessage(id, text, sendOptions);
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      waitForFinish: async (timeoutMs) => {
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      commands: (options) => daemonClient.listCommands({ agentId: id, ...options }),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (current) {
          current = { ...current, archivedAt: result.archivedAt };
        }
        return result;
      },
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      subscribe: (handler) =>
        listen((update) => {
          if (update.kind === "upsert" && update.agent.id === id) {
            current = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | OsunaWorkspaceOpenOptions,
  requestId?: string,
): Promise<OsunaWorkspaceHandle> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  if (result.error || !result.workspace) {
    throw new Error(result.error ?? `The daemon did not open a workspace for ${options.cwd}`);
  }
  return createWorkspaceHandle(result.workspace);
}

function resolveWorkspaceId(workspace: string | OsunaWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function resolveAgentId(agent: string | OsunaAgentHandle): string {
  return typeof agent === "string" ? agent : agent.id;
}

function parseProviderModel(selection: string): { provider: string; model: string } {
  const separator = selection.indexOf("/");
  if (separator <= 0 || separator === selection.length - 1) {
    throw new Error('Expected config.provider in "provider/model" format');
  }
  return {
    provider: selection.slice(0, separator),
    model: selection.slice(separator + 1),
  };
}

function listProviderUsage(
  daemonClient: DaemonClient,
  options?: OsunaProviderUsageOptions,
): Promise<OsunaProviderUsageResult> {
  // COMPAT(providerUsageList): added in v0.1.98, remove after 2027-02-28 once daemon floor >= v0.1.98.
  if (daemonClient.getLastServerInfoMessage()?.features?.providerUsageList !== true) {
    return Promise.reject(new Error("Update the host to list provider usage."));
  }
  return daemonClient.listProviderUsage(options);
}

async function waitForProvidersReady(
  daemonClient: DaemonClient,
  observation: ReturnType<DaemonClient["observeEvents"]>,
  signal: AbortSignal,
  options: OsunaProviderWaitOptions = {},
): Promise<OsunaProviderSnapshotResult> {
  const { timeoutMs = 60_000, ...snapshotOptions } = options;

  try {
    await observation.ready;
    signal.throwIfAborted();
    return await new Promise<OsunaProviderSnapshotResult>((resolve, reject) => {
      let settled = false;
      let requestId: string | null = null;
      let snapshotCwd: string | undefined;
      const pendingUpdates = new Map<string | undefined, OsunaProviderSnapshotUpdate>();
      let latestEntries: OsunaProviderSnapshotResult["entries"] = [];

      const cleanup = () => {
        clearTimeout(timeout);
        unsubscribe();
        signal.removeEventListener("abort", abort);
      };
      const finish = (snapshot: OsunaProviderSnapshotResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(snapshot);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const updateMatches = (update: OsunaProviderSnapshotUpdate) => update.cwd === snapshotCwd;

      const unsubscribe = observation.subscribe({
        snapshot: () => {},
        update: (message) => {
          if (message.type !== "providers_snapshot_update") return;
          const update = message.payload;
          if (!requestId) {
            pendingUpdates.set(update.cwd, update);
            return;
          }
          if (!updateMatches(update)) return;
          latestEntries = update.entries;
          if (update.entries.some((entry) => entry.status === "loading")) return;
          finish({ ...update, requestId });
        },
      });
      const abort = () => fail(new Error("Osuna API is disposed"));
      signal.addEventListener("abort", abort, { once: true });

      const timeout = setTimeout(() => {
        const loading = latestEntries
          .filter((entry) => entry.status === "loading")
          .map((entry) => entry.provider)
          .join(", ");
        fail(
          new Error(
            loading
              ? `Timed out waiting for providers: ${loading}`
              : "Timed out waiting for provider discovery",
          ),
        );
      }, timeoutMs);

      void daemonClient
        .getProvidersSnapshot(snapshotOptions)
        .then((snapshot) => {
          requestId = snapshot.requestId;
          snapshotCwd = snapshot.cwd;
          latestEntries = snapshot.entries;
          if (!snapshot.entries.some((entry) => entry.status === "loading")) {
            finish(snapshot);
            return;
          }
          const pendingUpdate = pendingUpdates.get(snapshotCwd);
          if (pendingUpdate && !pendingUpdate.entries.some((entry) => entry.status === "loading")) {
            finish({ ...pendingUpdate, requestId });
          }
          return undefined;
        })
        .catch(fail);
    });
  } finally {
    await observation.release();
  }
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `osuna-sdk-${randomId}`;
}
