// 重置次数与重置清单照 magpie（https://github.com/yetone/magpie，internal/provider/codex_resets.go，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { UsageReset, UsageResets } from "@getpaseo/plugin/server/usage";
import { z } from "zod";

const RESETS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
// 第二次请求只为每张的过期时间：等不到就只写次数。
const LIST_TIMEOUT_MS = 4_000;

const listSchema = z.object({
  credits: z
    .array(
      z.object({
        id: z.string().optional(),
        status: z.string().optional(),
        expires_at: z.string().nullish(),
      }),
    )
    .nullish(),
});

/** 账号还有几次重置（wham/usage 给的次数），再问清单要每张的过期时间；清单读不到只留次数。没有重置时为 undefined。 */
export async function readResets(input: {
  count: number | undefined;
  headers: Record<string, string>;
  fetchApi: typeof fetch;
}): Promise<UsageResets | undefined> {
  const count = input.count ?? 0;
  if (count <= 0) return undefined;
  const cards = await readCards(input.headers, input.fetchApi);
  if (!cards) return { count, until: null };
  return {
    count,
    until: cards[0]?.until ?? null,
    // 张数和次数对不上的清单不当成这些次数列出来
    ...(cards.length === count ? { each: cards } : {}),
  };
}

/** 还没用的每一张，最早过期的在前、不过期的在后；请求或回复不对时为 null。 */
async function readCards(
  headers: Record<string, string>,
  fetchApi: typeof fetch,
): Promise<UsageReset[] | null> {
  try {
    const response = await fetchApi(RESETS_URL, {
      headers,
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const list = listSchema.parse(await response.json());
    const cards = (list.credits ?? [])
      .filter((credit) => credit.status === "available" && credit.id)
      .map((credit) => ({ until: expiry(credit.expires_at) }));
    return cards.sort(
      (a, b) =>
        (a.until ? Date.parse(a.until) : Infinity) - (b.until ? Date.parse(b.until) : Infinity),
    );
  } catch (error) {
    if (isListFailure(error)) return null;
    throw error;
  }
}

/** 清单读不到的几种：超时、连不上、回复不是 JSON 或不是清单的形状；别的照常抛出。 */
function isListFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    error instanceof SyntaxError ||
    error instanceof z.ZodError ||
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}

// 照 magpie 的 time.Parse(time.RFC3339)：别的写法当作不过期。
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

function expiry(value: string | null | undefined): string | null {
  if (!value || !RFC3339.test(value)) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}
