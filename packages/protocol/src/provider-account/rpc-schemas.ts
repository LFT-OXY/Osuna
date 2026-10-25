import { z } from "zod";

/*
 * 提供方账号（Account）与多号自动轮换（Rotate accounts）：Codex、Claude Code 设置页的「账号」一节。
 * 只有声明了 server_info.features.accountRotation 的 daemon 认这些 RPC。
 * provider 用字符串而非枚举，以后多一家时老客户端照常解析；daemon 只认 codex 与 claude。
 * 任何响应都不带 token：当前在用的号的登录只在 CLI 自己那里，Osuna 只记它的资料。
 */

/** daemon 给做多号自动轮换的提供方；线上 provider 仍是字符串，两端用这份清单收窄。 */
export const ACCOUNT_ROTATION_PROVIDERS = ["codex", "claude"] as const;
export type AccountRotationProvider = (typeof ACCOUNT_ROTATION_PROVIDERS)[number];

export function isAccountRotationProvider(value: string): value is AccountRotationProvider {
  return (ACCOUNT_ROTATION_PROVIDERS as readonly string[]).includes(value);
}

/** 一个窗口的用量，取自套餐用量来源的同一份读数（字段是 usage 报告窗口的子集）。 */
export const ProviderAccountWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  shortLabel: z.string().optional(),
  usedPct: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(),
});
export type ProviderAccountWindow = z.infer<typeof ProviderAccountWindowSchema>;

/**
 * 号的额度：还在读、读到了、读不到。读不到时 reason 是英文原因；code 是客户端能翻译的已知原因：
 * not_found（套餐用量来源看不到这个登录）、not_read_yet（还没读过）。
 */
export const ProviderAccountUsageSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reading") }),
  z.object({
    status: z.literal("read"),
    fetchedAt: z.string(),
    windows: z.array(ProviderAccountWindowSchema),
  }),
  z.object({ status: z.literal("failed"), reason: z.string(), code: z.string().optional() }),
]);
export type ProviderAccountUsage = z.infer<typeof ProviderAccountUsageSchema>;

/**
 * 号的登录失效（「需要重新登录」）：续期被拒或被吊销，这个号退出轮换，直到用户「重新登录」。
 * reason 是英文原因；code 是 OpenAI 回的错误码（invalid_grant、refresh_token_reused、token_revoked）或 refused。
 */
export const ProviderAccountNeedsSignInSchema = z.object({
  reason: z.string(),
  code: z.string().optional(),
});
export type ProviderAccountNeedsSignIn = z.infer<typeof ProviderAccountNeedsSignInSchema>;

/** 列表里的一个号；按用户排的顺序，第一个就是「第一」。signedIn：CLI 现在登录的就是它（「使用中」）。 */
export const ProviderAccountSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  plan: z.string().optional(),
  signedIn: z.boolean(),
  usage: ProviderAccountUsageSchema,
  // 没有就是登录正常。
  needsSignIn: ProviderAccountNeedsSignInSchema.optional(),
});
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;

/** 这一家的轮换设置；riskNoticeSeen：这台主机上已经确认过这家的风险提示。 */
export const ProviderAccountSettingsSchema = z.object({
  rotationEnabled: z.boolean(),
  riskNoticeSeen: z.boolean(),
});
export type ProviderAccountSettings = z.infer<typeof ProviderAccountSettingsSchema>;

/**
 * 这一节为什么停着：
 * - cli_sign_ins_off：「读取 CLI 登录凭证」关着，什么都不读，开关不可点；
 * - login_unsupported：Osuna 换不了这种登录，reason 是英文原因；code 是客户端能翻译的已知原因：
 *   ephemeral（Codex 只在内存里存登录）、unknown_store（cli_auth_credentials_store 是不认识的值）、
 *   config_unparsable（config.toml 读不懂）、keyring_unavailable（这个系统上 Osuna 读不了钥匙串）、
 *   login_unparsable（登录读不懂）、account_unknown（Claude Code 没记下登录的是哪个号）。
 */
export const ProviderAccountBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cli_sign_ins_off") }),
  z.object({ kind: z.literal("login_unsupported"), code: z.string(), reason: z.string() }),
]);
export type ProviderAccountBlock = z.infer<typeof ProviderAccountBlockSchema>;

/**
 * 操作失败：code 是已知取值之一或别的字符串，message 是给用户看的原因。
 * - risk_notice_required：第一次为这家打开轮换，要先确认风险提示（带 acknowledgeRiskNotice 重发）；
 * - cli_sign_ins_off、login_unsupported：同 ProviderAccountBlock；
 * - not_signed_in：CLI 现在没有登录，第一个号登记不了；
 * - unsupported_provider：daemon 不给这家做轮换；
 * - failed：别的失败（如账号存储读不懂，也没有上一份好的），message 是原因。
 */
export const ProviderAccountErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ProviderAccountError = z.infer<typeof ProviderAccountErrorSchema>;

const ProviderAccountStateSchema = z.object({
  requestId: z.string(),
  provider: z.string(),
  settings: ProviderAccountSettingsSchema,
  accounts: z.array(ProviderAccountSchema),
  blocked: ProviderAccountBlockSchema.nullable(),
  error: ProviderAccountErrorSchema.nullable(),
});

export const ProviderAccountListRequestSchema = z.object({
  type: z.literal("provider.account.list.request"),
  requestId: z.string(),
  provider: z.string(),
});
export type ProviderAccountListRequest = z.infer<typeof ProviderAccountListRequestSchema>;

export const ProviderAccountListResponseSchema = z.object({
  type: z.literal("provider.account.list.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountListResponse = z.infer<typeof ProviderAccountListResponseSchema>;

/**
 * 打开或关掉这家的多号自动轮换。第一次为这家打开时要带 acknowledgeRiskNotice（用户在风险提示里按了「我知道了，打开」），
 * 否则回 risk_notice_required、开关不动；带了就记下「看过了」。打开时把 CLI 当前登录的号登记为第 1 个号。
 */
export const ProviderAccountSetRotationRequestSchema = z.object({
  type: z.literal("provider.account.set_rotation.request"),
  requestId: z.string(),
  provider: z.string(),
  enabled: z.boolean(),
  acknowledgeRiskNotice: z.boolean().optional(),
});
export type ProviderAccountSetRotationRequest = z.infer<
  typeof ProviderAccountSetRotationRequestSchema
>;

export const ProviderAccountSetRotationResponseSchema = z.object({
  type: z.literal("provider.account.set_rotation.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountSetRotationResponse = z.infer<
  typeof ProviderAccountSetRotationResponseSchema
>;

/**
 * 某家的账号或设置变了（额度读完、开关被别的设备改了）；客户端重读列表。不带内容：带关联字段会被当成某个请求的回复。
 */
export const ProviderAccountChangedMessageSchema = z.object({
  type: z.literal("provider.account.changed"),
});
export type ProviderAccountChangedMessage = z.infer<typeof ProviderAccountChangedMessageSchema>;

/*
 * 加号与重新登录（照 magpie 的 signin.go）：Codex 由 daemon 跑 PKCE OAuth，回调监听 127.0.0.1:1455；
 * 端口被占（callbackBlocked）或用户不在主机前时，把浏览器最后跳到的地址粘回来（submit）完成。
 * 10 分钟没完成算超时。状态变化经 provider.account.changed 广播，客户端用 get 重读这次登录。
 */

const ProviderAccountSignInBaseSchema = z.object({
  id: z.string(),
  provider: z.string(),
  // 「重新登录」的那个号；加号时没有。
  accountId: z.string().optional(),
  // 要在浏览器里打开的登录页。
  authUrl: z.string(),
  // 主机上的回调端口开不了，只能粘贴地址完成。
  callbackBlocked: z.boolean(),
});

/**
 * 一次登录：等浏览器、完成、失败、被取消。
 * done：accountId 是加上或更新的号；alreadyAdded 为真时这个号原来就在列表里（「已经有这个号」）。
 * failed：code 是已知取值之一或别的字符串，message 是英文原因（exchange_failed 只是技术细节，
 * 如「HTTP 400: invalid_grant」，refused 是登录页给的原文）：
 *   timed_out（10 分钟没完成）、refused（登录页回了错误）、exchange_failed（换 token 失败）、
 *   no_account（登录没说是哪个号）、different_account（重新登录登的不是这个号）、cli_sign_ins_off、failed。
 */
export const ProviderAccountSignInSchema = z.discriminatedUnion("status", [
  ProviderAccountSignInBaseSchema.extend({ status: z.literal("waiting") }),
  ProviderAccountSignInBaseSchema.extend({
    status: z.literal("done"),
    result: z.object({
      accountId: z.string(),
      email: z.string().optional(),
      alreadyAdded: z.boolean(),
    }),
  }),
  ProviderAccountSignInBaseSchema.extend({
    status: z.literal("failed"),
    error: ProviderAccountErrorSchema,
  }),
  ProviderAccountSignInBaseSchema.extend({ status: z.literal("canceled") }),
]);
export type ProviderAccountSignIn = z.infer<typeof ProviderAccountSignInSchema>;

/**
 * 加号、重新登录各个请求的回复。signIn 是这次登录现在的样子（没找到时为 null）；
 * error：请求本身被拒——cli_sign_ins_off、unsupported_provider、not_found（没有这次登录或这个号）、
 * paste_invalid（粘贴的不是浏览器最后跳到的整段地址）、paste_mismatch（地址不是这次登录的）、
 * not_waiting（这次登录已经结束）、failed。
 */
const ProviderAccountSignInPayloadSchema = z.object({
  requestId: z.string(),
  signIn: ProviderAccountSignInSchema.nullable(),
  error: ProviderAccountErrorSchema.nullable(),
});

/** 开始加号；带 accountId 是给这个号「重新登录」。同一家同时只有一次登录，新开的取代旧的。 */
export const ProviderAccountSignInStartRequestSchema = z.object({
  type: z.literal("provider.account.sign_in.start.request"),
  requestId: z.string(),
  provider: z.string(),
  accountId: z.string().optional(),
});
export type ProviderAccountSignInStartRequest = z.infer<
  typeof ProviderAccountSignInStartRequestSchema
>;
export const ProviderAccountSignInStartResponseSchema = z.object({
  type: z.literal("provider.account.sign_in.start.response"),
  payload: ProviderAccountSignInPayloadSchema,
});
export type ProviderAccountSignInStartResponse = z.infer<
  typeof ProviderAccountSignInStartResponseSchema
>;

export const ProviderAccountSignInGetRequestSchema = z.object({
  type: z.literal("provider.account.sign_in.get.request"),
  requestId: z.string(),
  signInId: z.string(),
});
export type ProviderAccountSignInGetRequest = z.infer<typeof ProviderAccountSignInGetRequestSchema>;
export const ProviderAccountSignInGetResponseSchema = z.object({
  type: z.literal("provider.account.sign_in.get.response"),
  payload: ProviderAccountSignInPayloadSchema,
});
export type ProviderAccountSignInGetResponse = z.infer<
  typeof ProviderAccountSignInGetResponseSchema
>;

export const ProviderAccountSignInCancelRequestSchema = z.object({
  type: z.literal("provider.account.sign_in.cancel.request"),
  requestId: z.string(),
  signInId: z.string(),
});
export type ProviderAccountSignInCancelRequest = z.infer<
  typeof ProviderAccountSignInCancelRequestSchema
>;
export const ProviderAccountSignInCancelResponseSchema = z.object({
  type: z.literal("provider.account.sign_in.cancel.response"),
  payload: ProviderAccountSignInPayloadSchema,
});
export type ProviderAccountSignInCancelResponse = z.infer<
  typeof ProviderAccountSignInCancelResponseSchema
>;

/** 用粘贴的地址（浏览器最后跳到的那个）完成登录；回复等这次登录结束（完成或失败）再回。 */
export const ProviderAccountSignInSubmitRequestSchema = z.object({
  type: z.literal("provider.account.sign_in.submit.request"),
  requestId: z.string(),
  signInId: z.string(),
  callbackUrl: z.string(),
});
export type ProviderAccountSignInSubmitRequest = z.infer<
  typeof ProviderAccountSignInSubmitRequestSchema
>;
export const ProviderAccountSignInSubmitResponseSchema = z.object({
  type: z.literal("provider.account.sign_in.submit.response"),
  payload: ProviderAccountSignInPayloadSchema,
});
export type ProviderAccountSignInSubmitResponse = z.infer<
  typeof ProviderAccountSignInSubmitResponseSchema
>;
