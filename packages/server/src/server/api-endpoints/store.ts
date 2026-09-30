import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { ClaudeSettingsTakeoverSchema } from "./claude-settings-patch.js";
import { CodexConfigTakeoverSchema } from "./codex-config-patch.js";

/*
 * $PASEO_HOME/api-endpoints/ 下的私有文件，全部 0600：
 * - endpoints.json：接口本身与每个提供方当前启用的接口，不含 key；
 * - keys.json：API key，只有 daemon 读，任何 RPC 都不返回；
 * - takeover-claude.json：接管记录，含用户原先写在 settings.json 里的值（可能是别的 token）；
 * - takeover-codex.json：config.toml 的接管记录，以及专用 provider 表当前属于哪个接口；
 * - codex-api-key：Codex 通过 auth.command 读取的 key，只有内容本身，没有换行；
 * - backups/：首次改写前的完整副本，只供手动找回。
 * 不进 config.json，因为 get_daemon_config 会把 agents.providers 原样发给客户端。
 */

export const API_ENDPOINT_PROVIDERS = ["claude", "codex"] as const;
export type ApiEndpointProvider = (typeof API_ENDPOINT_PROVIDERS)[number];

const StoredApiEndpointSchema = z.object({
  id: z.string(),
  provider: z.enum(API_ENDPOINT_PROVIDERS),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(z.object({ id: z.string(), label: z.string().optional() })),
  defaultModelId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StoredApiEndpoint = z.infer<typeof StoredApiEndpointSchema>;

const EndpointsFileSchema = z.object({
  endpoints: z.array(StoredApiEndpointSchema),
  active: z.record(z.string(), z.string()),
});
type EndpointsFile = z.infer<typeof EndpointsFileSchema>;

const KeysFileSchema = z.object({ keys: z.record(z.string(), z.string()) });

const ClaudeTakeoverFileSchema = z.object({
  // null：当前没有接管（官方模式）。
  takeover: ClaudeSettingsTakeoverSchema.nullable(),
  // 首次改写前的完整副本，整个生命周期只做一次。null：还没改写过；
  // path 为 null：首次改写时文件不存在，没有可备份的。
  backup: z.object({ path: z.string().nullable() }).nullable(),
});
export type ClaudeTakeoverFile = z.infer<typeof ClaudeTakeoverFileSchema>;

const CodexTakeoverFileSchema = z.object({
  // null：当前没有接管（官方模式）。
  takeover: CodexConfigTakeoverSchema.nullable(),
  // config.toml 里的专用 provider 表写的是哪个接口；切回官方后仍在，删除该接口时连同 key 文件一起删。
  providerTable: z.object({ endpointId: z.string() }).nullable(),
  backup: z.object({ path: z.string().nullable() }).nullable(),
});
export type CodexTakeoverFile = z.infer<typeof CodexTakeoverFileSchema>;

const CODEX_KEY_FILE = "codex-api-key";

export class ApiEndpointStore {
  private readonly root: string;

  constructor(paseoHome: string) {
    this.root = path.join(paseoHome, "api-endpoints");
  }

  /** 把首次改写前的字节原样存一份，返回副本路径；文件不存在时返回 null。 */
  writeClaudeSettingsBackup(bytes: Buffer | null, at: Date): string | null {
    return this.writeBackup({ bytes, at, prefix: "claude-settings", extension: "json" });
  }

  writeCodexConfigBackup(bytes: Buffer | null, at: Date): string | null {
    return this.writeBackup({ bytes, at, prefix: "codex-config", extension: "toml" });
  }

  listEndpoints(provider: ApiEndpointProvider): StoredApiEndpoint[] {
    return this.readEndpoints().endpoints.filter((endpoint) => endpoint.provider === provider);
  }

  getEndpoint(provider: ApiEndpointProvider, id: string): StoredApiEndpoint | null {
    return this.listEndpoints(provider).find((endpoint) => endpoint.id === id) ?? null;
  }

  getActiveEndpointId(provider: ApiEndpointProvider): string | null {
    return this.readEndpoints().active[provider] ?? null;
  }

  setActiveEndpointId(provider: ApiEndpointProvider, id: string | null): void {
    const file = this.readEndpoints();
    const active = { ...file.active };
    if (id === null) {
      delete active[provider];
    } else {
      active[provider] = id;
    }
    this.writeEndpoints({ ...file, active });
  }

  /** key 为 undefined 表示保留已存的 key。 */
  upsertEndpoint(endpoint: StoredApiEndpoint, apiKey: string | undefined): void {
    if (apiKey !== undefined) {
      const keys = this.readKeys();
      this.writeKeys({ ...keys, [endpoint.id]: apiKey });
    }
    const file = this.readEndpoints();
    const index = file.endpoints.findIndex((existing) => existing.id === endpoint.id);
    const endpoints =
      index === -1 ? [...file.endpoints, endpoint] : file.endpoints.with(index, endpoint);
    this.writeEndpoints({ ...file, endpoints });
  }

  removeEndpoint(provider: ApiEndpointProvider, id: string): void {
    const file = this.readEndpoints();
    this.writeEndpoints({
      ...file,
      endpoints: file.endpoints.filter(
        (endpoint) => !(endpoint.provider === provider && endpoint.id === id),
      ),
    });
    const { [id]: _removed, ...keys } = this.readKeys();
    this.writeKeys(keys);
  }

  getApiKey(id: string): string | null {
    return this.readKeys()[id] ?? null;
  }

  readClaudeTakeover(): ClaudeTakeoverFile {
    const raw = this.readJson("takeover-claude.json");
    return raw === null ? { takeover: null, backup: null } : ClaudeTakeoverFileSchema.parse(raw);
  }

  writeClaudeTakeover(file: ClaudeTakeoverFile): void {
    this.writeJson("takeover-claude.json", ClaudeTakeoverFileSchema.parse(file));
  }

  readCodexTakeover(): CodexTakeoverFile {
    const raw = this.readJson("takeover-codex.json");
    return raw === null
      ? { takeover: null, providerTable: null, backup: null }
      : CodexTakeoverFileSchema.parse(raw);
  }

  writeCodexTakeover(file: CodexTakeoverFile): void {
    this.writeJson("takeover-codex.json", CodexTakeoverFileSchema.parse(file));
  }

  get codexKeyFilePath(): string {
    return path.join(this.root, CODEX_KEY_FILE);
  }

  /** null 表示删掉。 */
  writeCodexKeyFile(bytes: string | Buffer | null): void {
    if (bytes === null) {
      rmSync(this.codexKeyFilePath, { force: true });
      return;
    }
    writePrivateFileAtomicSync(this.codexKeyFilePath, bytes);
  }

  private writeBackup(input: {
    bytes: Buffer | null;
    at: Date;
    prefix: string;
    extension: string;
  }): string | null {
    if (input.bytes === null) return null;
    const stamp = input.at.toISOString().replaceAll(":", "-");
    const backupPath = path.join(
      this.root,
      "backups",
      `${input.prefix}.${stamp}.${input.extension}`,
    );
    writePrivateFileAtomicSync(backupPath, input.bytes);
    return backupPath;
  }

  private readEndpoints(): EndpointsFile {
    const raw = this.readJson("endpoints.json");
    return raw === null ? { endpoints: [], active: {} } : EndpointsFileSchema.parse(raw);
  }

  private writeEndpoints(file: EndpointsFile): void {
    this.writeJson("endpoints.json", EndpointsFileSchema.parse(file));
  }

  private readKeys(): Record<string, string> {
    const raw = this.readJson("keys.json");
    return raw === null ? {} : KeysFileSchema.parse(raw).keys;
  }

  private writeKeys(keys: Record<string, string>): void {
    this.writeJson("keys.json", KeysFileSchema.parse({ keys }));
  }

  private readJson(name: string): unknown {
    let text: string;
    try {
      text = readFileSync(path.join(this.root, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return JSON.parse(text) as unknown;
  }

  private writeJson(name: string, value: unknown): void {
    writePrivateFileAtomicSync(path.join(this.root, name), `${JSON.stringify(value, null, 2)}\n`);
  }
}
