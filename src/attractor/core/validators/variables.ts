import type { Node } from "../../types.js";
import type { AgentConfig } from "../../../cli/lib/agent.js";
import { loadAgent } from "../../../cli/lib/agent-loader.js";
import type { ValidationContext } from "./context.js";
import { RESERVED_VARS } from "./context.js";
import { STRING_ATTRS } from "../../transforms/variable-expansion.js";
import { toCamel } from "../dot-common.js";
import { resolveInputDecl } from "../../transforms/inputs-resolver.js";

const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;

export function runEarly(ctx: ValidationContext): void {
  checkVariableCoverage(ctx);
  checkPortabilityHeuristic(ctx);
}

export function runLate(ctx: ValidationContext): void {
  checkRequiredCallerVars(ctx);
}

function checkVariableCoverage(ctx: ValidationContext): void {
  const { nodes } = ctx.graph;
  const { traversal, nodeProduces, callerInputs, diags } = ctx;

  const startNodes = [...nodes.values()].filter((n) => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start");

  if (startNodes.length === 1) {
    const startId = startNodes[0].id;
    for (const [consumerId, consumer] of nodes) {
      // Walk every string-valued attribute named in STRING_ATTRS for $var refs.
      const fields = STRING_ATTRS
        .map((attr) => (consumer as Record<string, unknown>)[attr])
        .filter((f): f is string => typeof f === "string");
      const vars = new Set<string>();
      for (const field of fields) {
        let m: RegExpExecArray | null;
        const re = new RegExp(VAR_RE.source, VAR_RE.flags);
        while ((m = re.exec(field)) !== null) {
          vars.add(m[1].replace(/\.+$/, ""));
        }
      }

      for (const varName of vars) {
        if (RESERVED_VARS.has(varName)) continue;
        if (callerInputs.has(varName)) continue;

        // Resolve qualified $node.key into source/localKey pair to look up
        // outputs declared on the named source node (auto_inputs convention).
        // Pseudo-keys with dots (tool.output, store.path, chat.output) are
        // stored verbatim in produced sets — caught by the verbatim match below.
        let sourceFilter: string | undefined;
        let lookupKey = varName;
        const dotIdx = varName.indexOf(".");
        if (dotIdx !== -1) {
          sourceFilter = varName.slice(0, dotIdx);
          lookupKey = varName.slice(dotIdx + 1);
        }

        if (traversal.hasDefault(consumer, lookupKey) || traversal.hasDefault(consumer, varName)) continue;

        // Find all producer nodes for this variable. Verbatim match handles
        // pseudo-keys + bare keys; qualified split handles `<node>.<key>` refs
        // against the named source node's bare-key outputs.
        const producers = new Set<string>();
        for (const [nodeId, produced] of nodeProduces) {
          if (produced.has(varName)) { producers.add(nodeId); continue; }
          if (sourceFilter !== undefined && nodeId === sourceFilter && produced.has(lookupKey)) {
            producers.add(nodeId);
          }
        }

        // If no producers exist at all, warn
        if (producers.size === 0) {
          diags.push({
            rule: "variable_coverage",
            severity: "warning",
            message: `Variable "$${varName}" referenced by node "${consumerId}" has no known producer`,
            location: consumer.sourceLocation,
          });
          continue;
        }

        // Check: is consumer reachable from start when all producers are removed?
        // If yes, there's a path that skips all producers → warn
        if (traversal.reachable(startId, consumerId, producers)) {
          const producerList = [...producers].join(", ");
          diags.push({
            rule: "variable_coverage",
            severity: "warning",
            message: `Variable "$${varName}" referenced by node "${consumerId}" may be undefined on path(s) that skip node "${producerList}"`,
            location: consumer.sourceLocation,
          });
        }
      }
    }
  }
}

function checkPortabilityHeuristic(ctx: ValidationContext): void {
  const { nodes } = ctx.graph;
  const diags = ctx.diags;

  // portability_heuristic — warn when node attributes embed project-specific path substrings
  const PORTABILITY_PATH_PATTERNS = ["meditations/", "docs/superpowers/"];
  for (const node of nodes.values()) {
    const fields = [node.prompt, node.toolCommand].filter((f): f is string => typeof f === "string");
    for (const field of fields) {
      for (const pat of PORTABILITY_PATH_PATTERNS) {
        if (field.includes(pat)) {
          diags.push({
            rule: "portability_heuristic",
            severity: "warning",
            message: `Node "${node.id}" hardcodes project path "${pat}" — use $variable and declare in inputs=`,
            location: node.sourceLocation,
          });
          break; // one warning per node per field is enough
        }
      }
    }
  }
}

function checkRequiredCallerVars(ctx: ValidationContext): void {
  const { graph, nodeProduces, dotDir, diags } = ctx;
  const RESERVED = new Set(["goal", "project", "run_id"]);

  // Gather all vars produced internally (by any node)
  const internallyProduced = new Set<string>();
  for (const produced of nodeProduces.values()) {
    for (const k of produced) internallyProduced.add(k);
  }

  // Resolve qualified `<node>.<key>` against the named source node's outputs;
  // bare keys against any internal producer.
  function isProduced(k: string): boolean {
    const dot = k.indexOf(".");
    if (dot !== -1) {
      const src = k.slice(0, dot);
      const localKey = k.slice(dot + 1);
      return nodeProduces.get(src)?.has(localKey) === true;
    }
    return internallyProduced.has(k);
  }

  // Candidate set: callerInputs declared on the digraph header
  const required = new Set<string>();
  for (const v of graph.inputs ?? []) {
    if (!RESERVED.has(v) && !isProduced(v)) required.add(v);
  }

  // Also include vars consumed via agent inputs: that are not produced internally
  // (or covered by a default_<localKey>= on the consumer node).
  if (dotDir) {
    for (const node of graph.nodes.values()) {
      if (!node.agent) continue;
      const cfg = tryResolveAgent(node, dotDir);
      if (!cfg?.inputs) continue;
      for (const k of cfg.inputs) {
        if (RESERVED.has(k)) continue;
        if (isProduced(k)) continue;
        let resolved;
        try { resolved = resolveInputDecl(k); } catch { continue; }
        const fallbackKey = toCamel("default_" + resolved.localKey);
        if (node[fallbackKey] !== undefined) continue;
        required.add(k);
      }
    }
  }

  if (required.size === 0) return;

  const keys = [...required].sort().join(", ");
  diags.push({
    rule: "required_caller_vars",
    severity: "info",
    message: `This pipeline requires the following --var keys at runtime: ${keys}`,
  });
}

// Local helper — mirrors tryResolveAgent in graph-validator.ts to avoid a
// cross-module import on a private function. Kept private to this module.
function tryResolveAgent(node: Node, dotDir: string | undefined): AgentConfig | undefined {
  if (!node.agent || !dotDir) return undefined;
  try {
    return loadAgent(node.agent as string, dotDir);
  } catch {
    return undefined;
  }
}
