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

/** 用户给窗口设的上限的范围（百分比整数，照 magpie account_caps.go 的 MinCap、MaxCap）。 */
export const ACCOUNT_LIMIT_MIN = 1;
export const ACCOUNT_LIMIT_MAX = 99;

/**
 * 这个窗口算不算整个号的额度：ID 带「:」的是 Codex 某个模型或功能自己的窗口（如 Code review），
 * weekly_model_<名字> 是 Claude 某个模型的每周窗口（如 Weekly · Opus）；换号不看它们，也不能给它们设上限
 * （照 magpie 只看不限模型、不另计的窗口）。
 */
export function isWholeAccountWindow(window: { id: string }): boolean {
  return !window.id.includes(":") && !window.id.startsWith("weekly_model_");
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
    // Codex 应用不让这个号发送：rate_limit.allowed 为假且没有 credits 可用（照 magpie 的 codexHeld）。
    held: z.boolean().optional(),
    // 这个号有 credits：窗口用完后 ChatGPT 改花 credits（照 magpie 的 OnCredits）。工单 06 起的 daemon 才发。
    onCredits: z.boolean().optional(),
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
  // 用户给各窗口设的上限：窗口 ID → 1–99 的百分比；没设的窗口按 98%。工单 05 起的 daemon 才发。
  limits: z.record(z.string(), z.number()).optional(),
  /**
   * 自动换号后的位置，已知取值之一或别的字符串：first_when_room（被换走的号，有余量后换回它、回到第一）、
   * temporarily_first（换上的号，排在前面的号没有余量时暂时当第一）。没有就是没在等换回。
   */
  standing: z.string().optional(),
});
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;

/** 这一家的轮换设置；riskNoticeSeen：这台主机上已经确认过这家的风险提示。 */
export const ProviderAccountSettingsSchema = z.object({
  rotationEnabled: z.boolean(),
  riskNoticeSeen: z.boolean(),
  // 「固定登录到」的号；null 是「不固定」。固定后完全不自动换。工单 05 起的 daemon 才发。
  keepSignedInTo: z.string().nullable().optional(),
  // Codex 的「只换登录」：不经过中转站换号，Codex 直连 OpenAI，只保留换登录。工单 06 起的 daemon 才发。
  switchOnly: z.boolean().optional(),
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

/** 换号的一端：号的 ID 与换号时的邮箱（号后来被移除，记录照样能显示）。 */
export const ProviderAccountSwitchEndSchema = z.object({
  accountId: z.string(),
  email: z.string().optional(),
});
export type ProviderAccountSwitchEnd = z.infer<typeof ProviderAccountSwitchEndSchema>;

/** 换走时到了的那个窗口：用到多少；limitPct 有值时是到了用户设的上限。 */
export const ProviderAccountSwitchWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number(),
  limitPct: z.number().optional(),
});
export type ProviderAccountSwitchWindow = z.infer<typeof ProviderAccountSwitchWindowSchema>;

/**
 * 一次换号，最新的在前，每家留最近 50 条。from 没有：换号前 CLI 没登录。
 * reason 是已知取值之一或别的字符串（以后加的原因，客户端认不出时显示通用说法）：
 * use_now（用户按了「立即使用」）、lapsed（原来的号登录失效）、
 * used_up（原来的号某个窗口用到 98%，window 是哪个）、limit（到了用户设的上限，window 是哪个）、
 * held（ChatGPT 不再让原来的号发送：额度用完且没有 credits）、room_again（排在前面的号有余量了，换回）、
 * keep_signed_in（「固定登录到」这个号）。
 */
export const ProviderAccountSwitchSchema = z.object({
  at: z.string(),
  from: ProviderAccountSwitchEndSchema.optional(),
  to: ProviderAccountSwitchEndSchema,
  reason: z.string(),
  window: ProviderAccountSwitchWindowSchema.optional(),
});
export type ProviderAccountSwitch = z.infer<typeof ProviderAccountSwitchSchema>;

/**
 * 最近一次换号没换成，下一次换成后清掉。to 是要换去的号（当前号失效、没有号可换时没有）。
 * code 是已知取值之一或别的字符串，message 是英文原因：
 * write_failed（写不进 CLI 的登录）、login_unsupported（Osuna 换不了这种登录）、
 * needs_sign_in（要换去的号需要重新登录）、no_account（当前号失效，没有别的号可换）。
 */
export const ProviderAccountSwitchFailureSchema = z.object({
  at: z.string(),
  to: ProviderAccountSwitchEndSchema.optional(),
  code: z.string(),
  message: z.string(),
});
export type ProviderAccountSwitchFailure = z.infer<typeof ProviderAccountSwitchFailureSchema>;

const ProviderAccountStateSchema = z.object({
  requestId: z.string(),
  provider: z.string(),
  settings: ProviderAccountSettingsSchema,
  accounts: z.array(ProviderAccountSchema),
  blocked: ProviderAccountBlockSchema.nullable(),
  error: ProviderAccountErrorSchema.nullable(),
  // 工单 04 起的 daemon 才发。
  switches: z.array(ProviderAccountSwitchSchema).optional(),
  switchFailure: ProviderAccountSwitchFailureSchema.nullable().optional(),
  // 工单 08 起：Claude Code 开着「使用第三方接口」，订阅号要等关掉开关才用得上（轮换照常转）。
  throughEndpoints: z.boolean().optional(),
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
 * 「立即使用」：把 CLI 的登录马上换成这个号。新开的会话用它，开着的仍在原来的号上。
 * 失败时 error 带原因（cli_sign_ins_off、not_found、login_unsupported、needs_sign_in、write_failed、
 * unsupported_provider），写不进 CLI 或号失效时同样记进 switchFailure。
 */
export const ProviderAccountUseRequestSchema = z.object({
  type: z.literal("provider.account.use.request"),
  requestId: z.string(),
  provider: z.string(),
  accountId: z.string(),
});
export type ProviderAccountUseRequest = z.infer<typeof ProviderAccountUseRequestSchema>;
export const ProviderAccountUseResponseSchema = z.object({
  type: z.literal("provider.account.use.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountUseResponse = z.infer<typeof ProviderAccountUseResponseSchema>;

/** 「移除」：只删 Osuna 存的这个号，不登出 CLI。号已经不在时回 not_found。 */
export const ProviderAccountRemoveRequestSchema = z.object({
  type: z.literal("provider.account.remove.request"),
  requestId: z.string(),
  provider: z.string(),
  accountId: z.string(),
});
export type ProviderAccountRemoveRequest = z.infer<typeof ProviderAccountRemoveRequestSchema>;
export const ProviderAccountRemoveResponseSchema = z.object({
  type: z.literal("provider.account.remove.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountRemoveResponse = z.infer<typeof ProviderAccountRemoveResponseSchema>;

/**
 * 号的先后：accountIds 是这家所有号的新顺序，第一个就是「第一」。
 * 与主机上的号对不上（别的设备刚加过或移除过）时回 order_mismatch，顺序不动。
 */
export const ProviderAccountSetOrderRequestSchema = z.object({
  type: z.literal("provider.account.set_order.request"),
  requestId: z.string(),
  provider: z.string(),
  accountIds: z.array(z.string()),
});
export type ProviderAccountSetOrderRequest = z.infer<typeof ProviderAccountSetOrderRequestSchema>;
export const ProviderAccountSetOrderResponseSchema = z.object({
  type: z.literal("provider.account.set_order.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountSetOrderResponse = z.infer<typeof ProviderAccountSetOrderResponseSchema>;

/**
 * 「设上限」：limits 是这个号各窗口的上限（窗口 ID → 1–99 的整数），整份替换；空对象是都不设。
 * 不在 1–99 之间时回 invalid_limit，什么都不改；号已经不在时回 not_found。
 */
export const ProviderAccountSetLimitsRequestSchema = z.object({
  type: z.literal("provider.account.set_limits.request"),
  requestId: z.string(),
  provider: z.string(),
  accountId: z.string(),
  limits: z.record(z.string(), z.number()),
});
export type ProviderAccountSetLimitsRequest = z.infer<typeof ProviderAccountSetLimitsRequestSchema>;
export const ProviderAccountSetLimitsResponseSchema = z.object({
  type: z.literal("provider.account.set_limits.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountSetLimitsResponse = z.infer<
  typeof ProviderAccountSetLimitsResponseSchema
>;

/**
 * 「固定登录到」：accountId 是要固定的号，null 是「不固定」。固定后完全不自动换；CLI 登录的不是它时，
 * 马上检查一次、换到它上面。号已经不在时回 not_found。
 */
export const ProviderAccountSetKeepSignedInRequestSchema = z.object({
  type: z.literal("provider.account.set_keep_signed_in.request"),
  requestId: z.string(),
  provider: z.string(),
  accountId: z.string().nullable(),
});
export type ProviderAccountSetKeepSignedInRequest = z.infer<
  typeof ProviderAccountSetKeepSignedInRequestSchema
>;
export const ProviderAccountSetKeepSignedInResponseSchema = z.object({
  type: z.literal("provider.account.set_keep_signed_in.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountSetKeepSignedInResponse = z.infer<
  typeof ProviderAccountSetKeepSignedInResponseSchema
>;

/**
 * Codex 的「只换登录」：打开时 Codex 的请求不经过中转站换号（不写 openai_base_url），只保留换登录；
 * 关掉时（轮换开着、有两个以上的号）Codex 的 ChatGPT 请求经过中转站，当前号接不了的交给下一个号。
 * 只有 Codex 有；别家回 unsupported_provider。
 */
export const ProviderAccountSetSwitchOnlyRequestSchema = z.object({
  type: z.literal("provider.account.set_switch_only.request"),
  requestId: z.string(),
  provider: z.string(),
  enabled: z.boolean(),
});
export type ProviderAccountSetSwitchOnlyRequest = z.infer<
  typeof ProviderAccountSetSwitchOnlyRequestSchema
>;
export const ProviderAccountSetSwitchOnlyResponseSchema = z.object({
  type: z.literal("provider.account.set_switch_only.response"),
  payload: ProviderAccountStateSchema,
});
export type ProviderAccountSetSwitchOnlyResponse = z.infer<
  typeof ProviderAccountSetSwitchOnlyResponseSchema
>;

/**
 * 某家的账号或设置变了（额度读完、开关被别的设备改了）；客户端重读列表。不带内容：带关联字段会被当成某个请求的回复。
 */
export const ProviderAccountChangedMessageSchema = z.object({
  type: z.literal("provider.account.changed"),
});
export type ProviderAccountChangedMessage = z.infer<typeof ProviderAccountChangedMessageSchema>;

/*
 * 加号与重新登录（照 magpie 的 signin.go、claude_signin.go）：
 * - Codex 由 daemon 跑 PKCE OAuth，回调监听 127.0.0.1:1455；端口被占（callbackBlocked）或用户不在主机前时，
 *   把浏览器最后跳到的地址粘回来（submit 的 callbackUrl）完成。
 * - Claude Code 由 daemon 在这个号的私有配置目录里后台运行真的 `claude auth login`：authUrl 是它要打开的、
 *   登录完跳回主机的页面；codeUrl 是它打印的、登录完显示一段代码的页面，不在主机前时打开它，
 *   把代码粘回来（submit 的 code）完成。Claude Code 没打开页面时 callbackBlocked 为真，只能粘贴代码。
 * 10 分钟没完成算超时。状态变化经 provider.account.changed 广播，客户端用 get 重读这次登录。
 */

const ProviderAccountSignInBaseSchema = z.object({
  id: z.string(),
  provider: z.string(),
  // 「重新登录」的那个号；加号时没有。
  accountId: z.string().optional(),
  // 要在浏览器里打开的登录页。
  authUrl: z.string(),
  // 浏览器回不到主机（Codex 的回调端口开不了、Claude Code 没打开页面），只能粘贴完成。
  callbackBlocked: z.boolean(),
  // Claude Code 打印的登录页：登录完显示一段代码，粘回来完成。工单 07 起的 daemon 才发。
  codeUrl: z.string().optional(),
});

/**
 * 一次登录：等浏览器、完成、失败、被取消。
 * done：accountId 是加上或更新的号；alreadyAdded 为真时这个号原来就在列表里（「已经有这个号」）。
 * failed：code 是已知取值之一或别的字符串，message 是英文原因（exchange_failed 只是技术细节，
 * 如「HTTP 400: invalid_grant」，refused 是登录页给的原文）：
 *   timed_out（10 分钟没完成）、refused（登录页回了错误）、exchange_failed（换 token 失败）、
 *   no_account（登录没说是哪个号）、different_account（重新登录登的不是这个号）、cli_sign_ins_off、failed；
 *   Claude Code 另有 no_email（登录后没记下邮箱）、login_failed（`claude auth login` 没登成，message 是它最后说的话）。
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
 * code_invalid（粘贴的不是 Claude 登录页显示的代码）、not_waiting（这次登录已经结束）、
 * cli_not_found（主机上找不到 Claude Code 的 `claude` 命令）、failed。
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

/**
 * 用粘贴的内容完成登录：Codex 是浏览器最后跳到的地址（callbackUrl），Claude Code 是登录页显示的代码（code）。
 * 回复等这次登录结束（完成或失败）再回。
 */
export const ProviderAccountSignInSubmitRequestSchema = z.object({
  type: z.literal("provider.account.sign_in.submit.request"),
  requestId: z.string(),
  signInId: z.string(),
  callbackUrl: z.string().optional(),
  // 工单 07 起的 daemon 才认。
  code: z.string().optional(),
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
