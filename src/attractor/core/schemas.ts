import { z } from "zod";

export const BaseNodeSchema = z.object({
  id: z.string(),
  shape: z.string().optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
  class: z.string().optional(),
}).strict();
