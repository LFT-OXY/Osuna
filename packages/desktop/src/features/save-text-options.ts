import { z } from "zod";

/**
 * What the renderer may ask `paseo:dialog:saveText` to write: text under a
 * plain file name (no folders: the dialog picks where), with optional filters
 * whose extensions are bare words.
 */
export const SaveTextOptionsSchema = z.object({
  title: z.string().optional(),
  defaultPath: z
    .string()
    .min(1)
    .regex(/^[^/\\]+$/),
  filters: z
    .array(
      z.object({
        name: z.string().min(1),
        extensions: z.array(z.string().regex(/^[A-Za-z0-9]+$/)).min(1),
      }),
    )
    .optional(),
  contents: z.string(),
});

export type SaveTextOptions = z.infer<typeof SaveTextOptionsSchema>;
