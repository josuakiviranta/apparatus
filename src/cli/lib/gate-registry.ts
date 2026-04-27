import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseFrontmatter } from "./frontmatter.js";
import { GateMdFrontmatterSchema } from "../../attractor/core/schemas.js";

export interface GateConfig {
  choices: string[];
  inputs?: string[];
  prompt: string;
}

export function resolveGate(
  nodeId: string,
  opts: { dotDir: string },
): GateConfig {
  const filePath = join(opts.dotDir, `${nodeId}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Gate file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const { attributes, body } = parseFrontmatter(content);
  const fm = GateMdFrontmatterSchema.parse(attributes);

  return {
    choices: fm.choices,
    inputs: fm.inputs,
    prompt: body.trim(),
  };
}
