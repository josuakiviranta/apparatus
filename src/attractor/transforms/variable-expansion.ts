import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Graph, Node } from "../types.js";
import { parseFrontmatter } from "../../cli/lib/frontmatter.js";
import { getBundledAgentsDir } from "../../cli/lib/assets.js";

export class UndefinedVariableError extends Error {
  constructor(public readonly variableName: string) {
    super(`Undefined variable $${variableName}`);
    this.name = "UndefinedVariableError";
  }
}

export function splitFences(s: string): Array<{ fenced: boolean; text: string }> {
  const out: Array<{ fenced: boolean; text: string }> = [];
  const lines = s.split(/(\n)/); // keep newlines as separate tokens so joins preserve them
  let buf = "";
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "\n") { buf += line; continue; }
    const opensOrCloses = /^```/.test(line);
    if (!inFence && opensOrCloses) {
      if (buf.length) out.push({ fenced: false, text: buf });
      buf = line;
      inFence = true;
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      buf += line;
      out.push({ fenced: true, text: buf });
      buf = "";
      inFence = false;
      continue;
    }
    buf += line;
  }
  if (buf.length) out.push({ fenced: inFence, text: buf });
  return out;
}

/**
 * Expand $key references in a string against a key-value context.
 * Skips $goal and $project (handled by the graph-level transform).
 * Throws UndefinedVariableError if a variable is not in ctx or defaults.
 * Fenced triple-backtick blocks are passed through unexpanded.
 */
export function expandVariables(
  s: string,
  ctx: Record<string, unknown>,
  defaults?: Record<string, string>,
): string {
  return splitFences(s)
    .map((seg) => (seg.fenced ? seg.text : expandSegment(seg.text, ctx, defaults)))
    .join("");
}

function expandSegment(
  s: string,
  ctx: Record<string, unknown>,
  defaults?: Record<string, string>,
): string {
  return s.replace(/\$([a-zA-Z_]\w*(?:\.\w+)*)/g, (match, key) => {
    if (key === "goal" || key === "project") return match;
    const v = ctx[key];
    if (v === undefined) {
      const fallback = defaults?.[key];
      if (fallback !== undefined) return fallback;
      throw new UndefinedVariableError(key);
    }
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
    return JSON.stringify(v);
  });
}

/**
 * Extract default_* node attributes into a flat Record<string, string>.
 * The DOT parser stores `default_<var>` as camelCase `default<Var>` on the node;
 * this reverses that back to the snake_case key used in $var interpolation
 * (ctx + defaults maps are keyed by the literal $var name authors wrote).
 * E.g. { defaultRefinements: "none" }      → { refinements: "none" }
 *      { defaultTestResult: "" }           → { test_result: "" }
 *      { defaultChatNotesPath: "" }        → { chat_notes_path: "" }
 */
export function extractDefaults(obj: Record<string, unknown>): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("default") && key.length > 7 && key[7] === key[7].toUpperCase()) {
      const tail = key.slice(7);
      const varName = (tail.charAt(0).toLowerCase() + tail.slice(1)).replace(
        /[A-Z]/g,
        (c) => "_" + c.toLowerCase(),
      );
      defaults[varName] = String(val);
    }
  }
  return defaults;
}

export function variableExpansionTransform(graph: Graph, vars: { project?: string; context?: Record<string, unknown> }): Graph {
  const goal = graph.goal ?? "";
  const project = vars.project ?? "";
  const ctx = vars.context ?? {};

  function expand(s: string): string {
    const replaced = s.replace(/\$goal/g, goal).replace(/\$project/g, project);
    try {
      return expandVariables(replaced, ctx);
    } catch (e) {
      if (e instanceof UndefinedVariableError) return replaced;
      throw e;
    }
  }

  const newNodes = new Map(
    [...graph.nodes.entries()].map(([id, node]) => {
      const n = { ...node };
      if (n.prompt) n.prompt = expand(n.prompt);
      if (n.toolCommand) n.toolCommand = expand(n.toolCommand);
      if (typeof n.cwd === "string") n.cwd = expand(n.cwd);
      if (typeof n.maxIterations === "string") n.maxIterations = expand(n.maxIterations);
      return [id, n];
    })
  );
  return { ...graph, nodes: newNodes };
}

const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;
const RESERVED = new Set(["goal", "project", "run_id"]);
// String-valued node attributes the scanner must walk for $var references.
// Keep in sync with the fields list in graph.ts variable_coverage check.
const STRING_ATTRS = ["prompt", "toolCommand", "label", "scriptArgs", "cwd"];

export { STRING_ATTRS };

export function findVarReferences(graph: Graph, varName: string): string[] {
  const re = new RegExp(`\\$${varName}\\b`);
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    for (const attr of STRING_ATTRS) {
      const v = (node as Record<string, unknown>)[attr];
      if (typeof v === "string" && re.test(v)) { out.push(node.id); break; }
    }
  }
  return out;
}

function collectVarRefs(node: Node, out: Set<string>): void {
  for (const key of STRING_ATTRS) {
    const v = (node as Record<string, unknown>)[key];
    if (typeof v !== "string") continue;
    const re = new RegExp(VAR_RE.source, VAR_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(v)) !== null) {
      const name = m[1].replace(/\.+$/, "");
      if (!RESERVED.has(name)) out.add(name);
    }
  }
}

function collectProducers(node: Node, out: Set<string>): void {
  if (typeof (node as Record<string, unknown>)["produces"] === "string") {
    const produces = (node as Record<string, unknown>)["produces"] as string;
    for (const name of produces.split(",").map((s) => s.trim()).filter(Boolean)) {
      out.add(name);
    }
  }
}

function collectAgentNoteSeed(node: Node, projectDir: string | undefined, out: Set<string>): void {
  const agentName = (node as Record<string, unknown>).agent;
  if (typeof agentName !== "string") return;
  const path = resolveAgentMdPath(projectDir, agentName);
  if (!path) return;
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return; }
  const { attributes } = parseFrontmatter(raw);
  const outputs = (attributes as Record<string, unknown>).outputs;
  if (outputs && typeof outputs === "object" && Object.prototype.hasOwnProperty.call(outputs, "note")) {
    out.add("prev_note");
  }
}

export type MissingRef = {
  name: string;
  source?: { file: string; line: number; agentName: string; nodeId: string };
};

function resolveAgentMdPath(projectDir: string | undefined, agentName: string): string | null {
  if (projectDir) {
    const local = join(projectDir, ".ralph/agents", `${agentName}.md`);
    if (existsSync(local)) return local;
  }
  const bundled = join(getBundledAgentsDir(), `${agentName}.md`);
  if (existsSync(bundled)) return bundled;
  return null;
}

type AgentSource = { file: string; line: number; agentName: string; nodeId: string };

function collectAgentBodyRefs(
  node: Node,
  projectDir: string | undefined,
  refs: Map<string, AgentSource[]>,
): void {
  const agentName = (node as Record<string, unknown>).agent;
  if (typeof agentName !== "string") return;
  // Skip body when an explicit prompt/label is provided — it overrides config.prompt at runtime.
  if ((node as Record<string, unknown>).prompt) return;
  if ((node as Record<string, unknown>).label) return;
  const path = resolveAgentMdPath(projectDir, agentName);
  if (!path) return;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const { body } = parseFrontmatter(raw);
  const frontmatterLineOffset = raw.length === body.length
    ? 0
    : raw.slice(0, raw.length - body.length).split("\n").length - 1;
  let segStart = 0;
  for (const seg of splitFences(body)) {
    if (!seg.fenced) {
      const re = new RegExp(VAR_RE.source, VAR_RE.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg.text)) !== null) {
        const name = m[1].replace(/\.+$/, "");
        if (RESERVED.has(name)) continue;
        const line = body.slice(0, segStart + m.index).split("\n").length + frontmatterLineOffset;
        const entry: AgentSource = { file: path, line, agentName, nodeId: node.id };
        const existing = refs.get(name);
        if (existing) existing.push(entry); else refs.set(name, [entry]);
      }
    }
    segStart += seg.text.length;
  }
}

export function scanUndeclaredCallerVars(
  graph: Graph,
  initialContext: Record<string, unknown>,
): { missing: MissingRef[]; declared: MissingRef[]; undeclared: MissingRef[] } {
  const attrRefs = new Set<string>();
  const producers = new Set<string>();
  const agentRefs = new Map<string, AgentSource[]>();
  const projectDir = typeof initialContext.project === "string" ? initialContext.project : undefined;

  for (const node of graph.nodes.values()) {
    collectVarRefs(node, attrRefs);
    collectProducers(node, producers);
    collectAgentNoteSeed(node, projectDir, producers);
    collectAgentBodyRefs(node, projectDir, agentRefs);
  }

  const ctxKeys = new Set(Object.keys(initialContext));
  const missing: MissingRef[] = [];

  for (const name of attrRefs) {
    if (ctxKeys.has(name) || producers.has(name)) continue;
    missing.push({ name });
  }
  for (const [name, sources] of agentRefs) {
    if (ctxKeys.has(name) || producers.has(name)) continue;
    for (const source of sources) missing.push({ name, source });
  }
  missing.sort((a, b) => a.name.localeCompare(b.name));

  const declaredSet = new Set(graph.inputs ?? []);
  const declared = missing.filter((r) => declaredSet.has(r.name));
  const undeclared = missing.filter((r) => !declaredSet.has(r.name));
  return { missing, declared, undeclared };
}
