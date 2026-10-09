// generate.mjs 写进样本 paseo://app 的全部内容。每个值都是虚构的：下面的主机、公钥、路径和草稿
// 从未真实存在过。各个名字下的结构照 0.14.2 渲染器的持久化形状写。

const LOCAL_HOST = {
  serverId: "srv_local_example",
  label: "This Mac",
  appearance: { color: "none", badgeDisplay: null },
  lifecycle: {},
  connections: [
    { id: "conn_local_tcp", type: "directTcp", endpoint: "localhost:6767", useTls: false },
  ],
  preferredConnectionId: "conn_local_tcp",
  createdAt: "2026-08-03T09:15:00.000Z",
  updatedAt: "2026-09-20T18:42:00.000Z",
};

const RELAY_HOST = {
  serverId: "srv_studio_example",
  label: "studio-mini",
  appearance: { color: "none", badgeDisplay: "name" },
  lifecycle: {},
  connections: [
    {
      id: "conn_studio_relay",
      type: "relay",
      relayEndpoint: "relay.example.test:443",
      useTls: true,
      daemonPublicKeyB64: "ZXhhbXBsZS1wdWJsaWMta2V5LW5vdC1hLXJlYWwta2V5",
    },
  ],
  preferredConnectionId: "conn_studio_relay",
  createdAt: "2026-08-11T12:00:00.000Z",
  updatedAt: "2026-09-21T07:30:00.000Z",
};

const DRAFT_ATTACHMENT_ID = "att_example_release_notes";
const WORKSPACE_KEY = "srv_local_example:/home/ada/code/example-app";

const DRAFTS = {
  state: {
    drafts: {
      "agent:srv_local_example:agent_example_01": {
        input: {
          text: "Rebase the release branch and re-run the flaky upload test before we tag.",
          attachments: [
            {
              kind: "image",
              metadata: {
                id: DRAFT_ATTACHMENT_ID,
                mimeType: "text/plain",
                storageType: "web-indexeddb",
                storageKey: DRAFT_ATTACHMENT_ID,
                fileName: "release-notes.txt",
                byteSize: 46,
                createdAt: 1758393600000,
              },
            },
          ],
        },
        lifecycle: "active",
        updatedAt: 1758393660000,
        version: 3,
      },
    },
    createModalDraft: null,
  },
  version: 5,
};

const PANEL_STATE = {
  state: {
    desktop: { agentListOpen: true, fileExplorerOpen: true, focusModeEnabled: false },
    explorerTab: "changes",
    explorerTabByCheckout: { [WORKSPACE_KEY]: "files" },
    expandedPathsByWorkspace: { [WORKSPACE_KEY]: ["src", "src/components"] },
    diffCollapsedFoldersByWorkspace: {},
    collapsedFilePathsByWorkspace: {},
    sidebarWidth: 312,
    explorerSortOption: "name",
    explorerShowHiddenFiles: false,
    treeRailWidth: 264,
    fileTreeVisible: true,
  },
  version: 16,
};

export const LEGACY_LOCAL_STORAGE = {
  "@paseo:daemon-registry": JSON.stringify([LOCAL_HOST, RELAY_HOST]),
  "@paseo:client-id-v1": "00000000-0000-4000-8000-00000000e2e1",
  "@paseo:app-settings": JSON.stringify({ theme: "dark", uiBaseFontSize: 15 }),
  "@paseo:settings-migrations": JSON.stringify({ desktopSettingsMoved: true }),
  "@paseo:create-agent-preferences": JSON.stringify({
    provider: "claude",
    providerPreferences: {},
  }),
  "@paseo:changes-preferences": JSON.stringify({ layout: "split", wrapLines: true }),
  "@paseo:changes-ship-default:/home/ada/code/example-app": "create-pr",
  "@paseo:keyboard-shortcut-overrides": JSON.stringify({ "workspace.new": "mod+shift+n" }),
  "@paseo:preferred-editor": "vscode",
  "@paseo:sidebar-callout-dismissals": JSON.stringify(["pair-device"]),
  "@paseo/provider-snapshot-index/v2": JSON.stringify([
    '@paseo/provider-snapshot/v2:["srv_local_example","cwd","/home/ada/code/example-app"]',
  ]),
  '@paseo/provider-snapshot/v2:["srv_local_example","cwd","/home/ada/code/example-app"]':
    JSON.stringify({ savedAt: 1758393600000, entries: [{ provider: "claude", status: "ready" }] }),
  "paseo:last-workspace-route-selection": JSON.stringify({
    serverId: "srv_local_example",
    workspaceId: "ws_example_app",
  }),
  "paseo-drafts": JSON.stringify(DRAFTS),
  "panel-state": JSON.stringify(PANEL_STATE),
  "workspace-layout-state": JSON.stringify({
    state: { layoutByWorkspace: { [WORKSPACE_KEY]: { tabs: ["agent_example_01"], split: null } } },
    version: 1,
  }),
  "workspace-browser-store": JSON.stringify({ state: { browsersById: {} }, version: 0 }),
  "sidebar-view": JSON.stringify({ state: { view: "projects" }, version: 0 }),
  "sidebar-collapsed-sections": JSON.stringify({ state: { collapsed: ["archived"] }, version: 0 }),
  "sidebar-project-workspace-order": JSON.stringify({
    state: { orderByProject: { "example-app": ["ws_example_app"] } },
    version: 0,
  }),
  "session-history-scope": JSON.stringify({ state: { scope: "workspace" }, version: 0 }),
  "workspace-service-route-preferences": JSON.stringify({ state: { routes: {} }, version: 0 }),
};

// 编号补零：IndexedDB 按键的字典序读回来，与这里的顺序一致。
function replicaRow(index) {
  const id = `agent_example_${String(index).padStart(2, "0")}`;
  return {
    serverId: "srv_local_example",
    kind: "agent",
    id,
    row: { id, title: `Example agent ${index}`, status: "idle", cwd: "/home/ada/code/example-app" },
  };
}

// blobText 在页面里变成真正的 Blob：0.14.x 把附件字节以 Blob 存进 IndexedDB，
// 这正是没法原样过 Electron IPC 的那类值。
export const LEGACY_DATABASES = [
  {
    name: "paseo-replica-row-store",
    version: 1,
    stores: [
      {
        name: "rows",
        keyPath: ["serverId", "kind", "id"],
        records: Array.from({ length: 40 }, (_, index) => ({ value: replicaRow(index + 1) })),
      },
      { name: "meta", keyPath: null, records: [{ key: "schema_version", value: 1 }] },
    ],
  },
  {
    name: "paseo-project-icon-cache",
    version: 1,
    stores: [
      {
        name: "key-value",
        keyPath: null,
        records: [
          {
            key: "srv_local_example:/home/ada/code/example-app",
            value: { dataUrl: "data:image/svg+xml;base64,PHN2Zy8+", savedAt: 1758393600000 },
          },
        ],
      },
    ],
  },
  {
    name: "paseo-attachment-bytes",
    version: 1,
    stores: [
      {
        name: "attachments",
        keyPath: "id",
        records: [
          {
            value: {
              id: DRAFT_ATTACHMENT_ID,
              createdAt: 1758393600000,
              fileName: "release-notes.txt",
            },
            blobField: "blob",
            blobText: "Example release notes kept as a draft attachment.",
            blobType: "text/plain",
          },
        ],
      },
    ],
  },
];
