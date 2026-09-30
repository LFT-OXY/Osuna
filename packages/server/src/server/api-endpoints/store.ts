import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { ClaudeSettingsTakeoverSchema } from "./claude-settings-patch.js";

/*
 * $PASEO_HOME/api-endpoints/ 下的私有文件，全部 0600：
 * - endpoints.json：接口本身与每个提供方当前启用的接口，不含 key；
 * - keys.json：API key，只有 daemon 读，任何 RPC 都不返回；
 * - takeover-claude.json：接管记录，含用户原先写在 settings.json 里的值（可能是别的 token）；
 * - backups/：首次改写前的完整副本，只供手动找回。
 * 不进 config.json，因为 get_daemon_config 会把 agents.providers 原样发给客户端。
 */

export const API_ENDPOINT_PROVIDERS = ["claude"] as const;
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

export class ApiEndpointStore {
  private readonly root: string;

  constructor(paseoHome: string) {
    this.root = path.join(paseoHome, "api-endpoints");
  }

  /** 把首次改写前的字节原样存一份，返回副本路径；文件不存在时返回 null。 */
  writeClaudeSettingsBackup(bytes: Buffer | null, at: Date): string | null {
    if (bytes === null) return null;
    const stamp = at.toISOString().replaceAll(":", "-");
    const backupPath = path.join(this.root, "backups", `claude-settings.${stamp}.json`);
    writePrivateFileAtomicSync(backupPath, bytes);
    return backupPath;
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
