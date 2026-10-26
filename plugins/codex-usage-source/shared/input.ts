import { z } from "zod";

export const routeSchema = z.discriminatedUnion("store", [
  // Osuna 存着的 Codex 号（多号自动轮换）：daemon 把它自己的 token 交过来，不经任何登录文件。
  z
    .object({
      store: z.literal("token"),
      accessToken: z.string().min(1),
      accountId: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ store: z.enum(["codex", "opencode", "pi"]), path: z.string().min(1) }).strict(),
  z
    .object({
      store: z.literal("omp"),
      path: z.string().min(1),
      credentialId: z.number().int().positive(),
    })
    .strict(),
]);
export const inputSchema = z.object({ route: routeSchema }).strict();
export type CodexUsageInput = z.infer<typeof inputSchema>;
