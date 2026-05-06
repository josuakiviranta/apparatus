import { readFileSync, existsSync } from "fs";
import { resolve, relative, dirname } from "path";
import type { Graph } from "../../attractor/types.js";
import { parseDot } from "../../attractor/core/graph.js";
import { DotSyntaxError } from "../../attractor/core/dot-syntax.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";
import { isNameShorthand, resolvePipelineArg } from "../lib/pipeline-resolver.js";
import type { Diagnostic } from "../../attractor/types.js";

export interface LoadedPipeline {
  graph: Graph;
  src: string;
  absPath: string;
  relPath: string;
  projectRoot: string;
  diagnostics: Diagnostic[];
}

export class PipelineLoadError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "read" | "syntax",
    readonly diagnostic?: Diagnostic,
    readonly src?: string,
    readonly absPath?: string,
    readonly relPath?: string,
  ) {
    super(message);
    this.name = "PipelineLoadError";
  }
}

export async function loadPipeline(
  dotFile: string,
  opts?: { project?: string }
): Promise<LoadedPipeline> {
  const projectRoot = resolve(opts?.project ?? process.cwd());
  const absPath = isNameShorthand(dotFile)
    ? resolvePipelineArg(dotFile, projectRoot)
    : resolve(dotFile);
  const relPath = relative(projectRoot, absPath);

  if (!existsSync(absPath)) {
    throw new PipelineLoadError(
      `Pipeline file not found: ${absPath}`,
      "not-found",
      undefined,
      undefined,
      absPath,
      undefined,
    );
  }

  let src: string;
  try {
    src = readFileSync(absPath, "utf8");
  } catch (e) {
    throw new PipelineLoadError(
      `Failed to read pipeline file: ${absPath}`,
      "read",
      undefined,
      undefined,
      absPath,
      undefined,
    );
  }

  let graph: Graph;
  try {
    graph = parseDot(src);
  } catch (e) {
    if (e instanceof DotSyntaxError) {
      const diagnostic: Diagnostic = {
        rule: "syntax",
        severity: "error",
        message: e.message,
        location: e.location,
      };
      throw new PipelineLoadError(e.message, "syntax", diagnostic, src, absPath, relPath);
    }
    throw new PipelineLoadError(String(e), "syntax", undefined, src, absPath, relPath);
  }

  const dotDir = dirname(absPath);
  const diagnostics = validateGraph(graph, dotDir);

  return { graph, src, absPath, relPath, projectRoot, diagnostics };
}
