// src/cli/lib/dag-schema.ts
import { z } from "zod";

export const ChunkStatusSchema = z.enum([
  "ready",
  "in_progress",
  "green",
  "merged",
  "conflicted",
  "blocked",
]);
export type ChunkStatus = z.infer<typeof ChunkStatusSchema>;

export const ChunkRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  depends_on: z.array(z.string()),
  files_touched: z.array(z.string()),
  branch: z.string().min(1),
  worktree_path: z.string().nullable(),
  status: ChunkStatusSchema,
  head_sha: z.string().nullable(),
  merge_sha: z.string().nullable(),
  conflict_files: z.array(z.string()).nullable(),
  resolver_attempts: z.number().int().nonnegative(),
});
export type ChunkRecord = z.infer<typeof ChunkRecordSchema>;

export const DagSchema = z
  .object({
    plan_path: z.string().min(1),
    pre_sha: z.string().nullable(),
    chunks: z.array(ChunkRecordSchema).min(0),
  })
  .superRefine((dag, ctx) => {
    const ids = new Set(dag.chunks.map((c) => c.id));
    for (const c of dag.chunks) {
      for (const dep of c.depends_on) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["chunks"],
            message: `chunk ${c.id} depends_on dangling id ${dep}`,
          });
        }
      }
    }
  });
export type Dag = z.infer<typeof DagSchema>;
