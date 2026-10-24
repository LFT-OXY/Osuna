import type { CliPicks } from "./cli-model-hold.js";
import {
  applyOmpConfig,
  applyOmpModels,
  inspectOmpConfig,
  inspectOmpModels,
  isOmpDefaultOnOsuna,
  keepOmpCliModel,
  migrateOmpModelsJson,
  readOmpCliPicks,
  readOmpGateway,
  readOmpModel,
  readOmpStartupReads,
  restoreOmpConfig,
  restoreOmpModels,
  type OmpMigration,
} from "./omp-config-patch.js";
import { ompModelEntry } from "./omp-model-entries.js";
import {
  applyPiModels,
  applyPiSettings,
  inspectPiModels,
  inspectPiSettings,
  keepPiCliModel,
  PI_PROVIDER_ID,
  readPiCliPicks,
  readPiDefaultProvider,
  readPiGateway,
  readPiModel,
  readPiStartupReads,
  restorePiModels,
  restorePiSettings,
  type PiConfigInspection,
  type PiConfigPatchResult,
  type PiConfigRestoreResult,
  type PiFileState,
  type PiGatewayAddress,
  type PiModelsTakeover,
  type PiSettingsApplyInput,
  type PiSettingsFile,
  type PiSettingsKeepInput,
  type PiSettingsTakeover,
  type PiStartupFiles,
} from "./pi-config-patch.js";
import { piModelEntry, type PiModelSource } from "./pi-model-entries.js";

/*
 * Pi 与 OMP（Pi 的分支）的配置改写是同一套做法（任务 10-16-pi-omp-endpoints）：一份模型文件里加 Osuna 的服务商，
 * 一份设置文件里写默认模型、默认思考档位与 enabledModels；接管记录同形。两家只是文件格式与键不同，
 * 这里把各自的补丁收成同一个接口，service.ts 只认这个接口。
 */

export const PI_LIKE_PROVIDERS = ["pi", "omp"] as const;
export type PiLikeProvider = (typeof PI_LIKE_PROVIDERS)[number];

export function isPiLike(provider: string): provider is PiLikeProvider {
  return PI_LIKE_PROVIDERS.some((candidate) => candidate === provider);
}

/** 服务商的地址是中转站的 /v1（Chat 与 Responses 都在它下面）。 */
export const PI_LIKE_GATEWAY_SUFFIX = "/v1";

/** 写进模型文件的服务商：中转站的根地址、这个 CLI 的口令与模型清单的来源。 */
export interface PiLikeProviderWiring {
  gatewayRoot: string;
  token: string;
  sources: PiModelSource[];
}

export interface PiLikeModelsApplyInput {
  // null 为文件不存在。
  text: string | null;
  wiring: PiLikeProviderWiring;
  takeover: PiModelsTakeover | null;
}

export interface PiLikeModelsRestoreInput extends PiFileState<PiModelsTakeover> {
  // 设置文件改回之后的内容：OMP 别处还用着 osuna/ 时服务商留着。
  settingsAfter: string | null;
}

export interface PiLikeCli {
  applyModels(input: PiLikeModelsApplyInput): PiConfigPatchResult<PiModelsTakeover>;
  restoreModels(input: PiLikeModelsRestoreInput): PiConfigRestoreResult;
  inspectModels(input: PiFileState<PiModelsTakeover | null>): PiConfigInspection;
  readGateway(text: string | null): PiGatewayAddress | null;
  applySettings(input: PiSettingsApplyInput): PiConfigPatchResult<PiSettingsTakeover>;
  restoreSettings(input: PiFileState<PiSettingsTakeover>): PiConfigRestoreResult;
  inspectSettings(input: PiSettingsFile): PiConfigInspection;
  readCliPicks(input: PiSettingsFile): CliPicks | null;
  keepCliModel(input: PiSettingsKeepInput): PiSettingsTakeover | null;
  readStartupReads(input: PiStartupFiles): string;
  /** 默认模型：Osuna 的只是模型（接口模型的 id），别的是「服务商/模型」；没设为 null。 */
  readModel(settingsText: string | null): string | null;
  /** 默认模型在 Osuna 的服务商上。 */
  isDefaultOnOsuna(settingsText: string | null): boolean;
  /** 只有旧格式的模型文件时先转成新格式（OMP 的 models.json）；没有这一步为 null。 */
  migrateLegacyModels: ((text: string) => OmpMigration) | null;
}

export const PI_CLI: PiLikeCli = {
  applyModels: (input) =>
    applyPiModels({
      text: input.text,
      takeover: input.takeover,
      block: {
        baseUrl: `${input.wiring.gatewayRoot}${PI_LIKE_GATEWAY_SUFFIX}`,
        api: "openai-completions",
        apiKey: input.wiring.token,
        compat: { sendSessionAffinityHeaders: true },
        models: input.wiring.sources.map((source) =>
          piModelEntry(source, input.wiring.gatewayRoot),
        ),
      },
    }),
  restoreModels: restorePiModels,
  inspectModels: inspectPiModels,
  readGateway: readPiGateway,
  applySettings: applyPiSettings,
  restoreSettings: restorePiSettings,
  inspectSettings: inspectPiSettings,
  readCliPicks: readPiCliPicks,
  keepCliModel: keepPiCliModel,
  readStartupReads: readPiStartupReads,
  readModel: readPiModel,
  isDefaultOnOsuna: (text) => readPiDefaultProvider(text) === PI_PROVIDER_ID,
  migrateLegacyModels: null,
};

export interface OmpCliOptions {
  // 本机 OMP 收不收 models.yml 里的 max（omp-model-entries.ts 的 ompTakesMax）。
  takesMax: boolean;
}

export function ompCli(options: OmpCliOptions): PiLikeCli {
  return {
    applyModels: (input) =>
      applyOmpModels({
        text: input.text,
        takeover: input.takeover,
        block: {
          baseUrl: `${input.wiring.gatewayRoot}${PI_LIKE_GATEWAY_SUFFIX}`,
          api: "openai-completions",
          auth: "apiKey",
          apiKey: input.wiring.token,
          compat: { promptCacheSessionHeader: "x-session-affinity" },
          models: input.wiring.sources.map((source) =>
            ompModelEntry(source, {
              gatewayRoot: input.wiring.gatewayRoot,
              takesMax: options.takesMax,
            }),
          ),
        },
      }),
    restoreModels: (input) =>
      restoreOmpModels({
        text: input.text,
        takeover: input.takeover,
        configAfter: input.settingsAfter,
      }),
    inspectModels: inspectOmpModels,
    readGateway: readOmpGateway,
    applySettings: applyOmpConfig,
    restoreSettings: restoreOmpConfig,
    inspectSettings: inspectOmpConfig,
    readCliPicks: readOmpCliPicks,
    keepCliModel: keepOmpCliModel,
    readStartupReads: readOmpStartupReads,
    readModel: readOmpModel,
    isDefaultOnOsuna: isOmpDefaultOnOsuna,
    migrateLegacyModels: migrateOmpModelsJson,
  };
}
