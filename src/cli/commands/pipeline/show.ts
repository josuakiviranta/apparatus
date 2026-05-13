import { writeFileSync } from "fs";
import { spawn } from "child_process";
import { join, basename, dirname, relative } from "path";
import {
  loadPipeline,
  PipelineLoadError,
  type LoadedPipeline,
} from "../pipeline-invocation.js";
import { formatPipelineDiag } from "../../lib/pipeline-diag-format.js";
import { annotateDotForShow } from "../../lib/annotate-show.js";
import * as output from "../../lib/output.js";
import type { Diagnostic } from "../../../attractor/types.js";

export interface PipelineShowOptions {
  /** Project folder used for name-shorthand resolution (mirrors validate/run). */
  project?: string;
  /**
   * Auto-open the rendered SVG via the OS default opener after writing it.
   * Default: `process.stdout.isTTY` — opens in interactive shells, skips in
   * vitest / CI / piped-stdout contexts so callers like
   * `pipeline-show-annotation.test.ts:40` (`pipelineShowCommand(..., {})`)
   * don't spawn `open` against a worker process.
   */
  open?: boolean;
}

async function renderDotToSvg(dotSrc: string): Promise<string> {
  const { Graphviz } = await import("@hpcc-js/wasm-graphviz");
  const gv = await Graphviz.load();
  return gv.dot(dotSrc);
}

function openWithOSDefault(filePath: string): void {
  const platform = process.platform;
  const child =
    platform === "darwin"
      ? spawn("open", [filePath], { stdio: "ignore", detached: true })
      : platform === "win32"
      ? spawn("cmd", ["/c", "start", "", filePath], { stdio: "ignore", detached: true })
      : spawn("xdg-open", [filePath], { stdio: "ignore", detached: true });
  child.on("error", () => {
    /* swallowed — the parent already logged a warning via the outer try/catch */
  });
  child.unref();
}

export async function pipelineShowCommand(
  dotFile: string,
  opts: PipelineShowOptions = {},
): Promise<number> {
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
  } catch (err) {
    if (err instanceof PipelineLoadError) {
      if (err.diagnostic) {
        await output.error(formatPipelineDiag(err.diagnostic, err.src ?? "", err.relPath ?? ""));
      } else if (err.kind === "not-found") {
        await output.error(`Dot file not found: ${dotFile}`);
      } else {
        await output.error(err.message);
      }
      return 1;
    }
    throw err;
  }

  const { graph, src, absPath, diagnostics: diags } = loaded;
  const relPath = relative(process.cwd(), absPath) || absPath;
  const formatDiag = (d: Diagnostic) => formatPipelineDiag(d, src, relPath);

  const errors = diags.filter(d => d.severity === "error");
  for (const w of diags.filter(d => d.severity === "warning")) await output.warn(formatDiag(w));
  for (const e of errors) await output.error(formatDiag(e));
  if (errors.length > 0) return 1;

  const annotated = annotateDotForShow(src, dirname(absPath));
  let svg: string;
  try {
    svg = await renderDotToSvg(annotated);
  } catch (err) {
    await output.error(`graphviz render failed: ${(err as Error).message}`);
    return 1;
  }

  const svgPath = join(dirname(absPath), basename(absPath, ".dot") + ".svg");
  try {
    writeFileSync(svgPath, svg);
  } catch (err) {
    await output.error(`Failed to write ${svgPath}: ${(err as Error).message}`);
    return 1;
  }

  const relSvg = relative(process.cwd(), svgPath) || svgPath;
  await output.success(
    `Wrote ${relSvg} (${graph.nodes.size} nodes, ${graph.edges.length} edges)`,
  );

  const shouldOpen = opts.open ?? Boolean(process.stdout.isTTY);
  if (shouldOpen) {
    try {
      openWithOSDefault(svgPath);
    } catch (err) {
      await output.warn(
        `Could not auto-open SVG (${(err as Error).message}); open manually at ${relSvg}`,
      );
    }
  }
  return 0;
}
