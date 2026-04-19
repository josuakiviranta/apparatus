import type { Graph, Node } from "../types.js";

export class UndefinedVariableError extends Error {
  constructor(public readonly variableName: string) {
    super(`Undefined variable $${variableName}`);
    this.name = "UndefinedVariableError";
  }
}

/**
 * Expand $key references in a string against a key-value context.
 * Skips $goal and $project (handled by the graph-level transform).
 * Throws UndefinedVariableError if a variable is not in ctx or defaults.
 */
export function expandVariables(
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
const STRING_ATTRS = ["prompt", "toolCommand", "label", "scriptArgs"];

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

export function scanUndeclaredCallerVars(
  graph: Graph,
  initialContext: Record<string, unknown>,
): { missing: string[]; declared: string[]; undeclared: string[] } {
  const refs = new Set<string>();
  const producers = new Set<string>();
  for (const node of graph.nodes.values()) {
    collectVarRefs(node, refs);
    collectProducers(node, producers);
  }

  const ctxKeys = new Set(Object.keys(initialContext));
  const missing: string[] = [];
  for (const name of refs) {
    if (ctxKeys.has(name)) continue;
    if (producers.has(name)) continue;
    missing.push(name);
  }
  missing.sort();

  const declaredSet = new Set(graph.inputs ?? []);
  const declared = missing.filter((n) => declaredSet.has(n));
  const undeclared = missing.filter((n) => !declaredSet.has(n));

  return { missing, declared, undeclared };
}
