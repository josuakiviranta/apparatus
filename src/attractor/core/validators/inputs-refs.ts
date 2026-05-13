import type { Graph, Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { SYSTEM_VARS } from "./context.js";
import { tryResolveAgent } from "./agent-resolver.js";
import { resolveInputDecl } from "../../transforms/inputs-resolver.js";
import { outputsToZod } from "../../../cli/lib/outputs-to-zod.js";
import { isInteractiveAgent } from "../graph.js";
import { parseConditionClauses } from "../conditions.js";
import { resolveGate } from "../../../cli/lib/gate-registry.js";
import { STRING_ATTRS } from "../../transforms/variable-expansion.js";
import { computeVarsInScope, computeVarsInAnyScope } from "../flow-analyzer.js";
import { buildForwardAdj, toCamel } from "../dot-common.js";
import * as interactive from "./interactive.js";
import { checkModelRequired } from "./model-required.js";

const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;

function isQualifiedKey(key: string): boolean {
  return key.includes(".");
}

export function run(ctx: ValidationContext): void {
  // Loop A — calls checkAgentOutputsConflict per node, NO dotDir guard.
  for (const node of ctx.graph.nodes.values()) {
    checkAgentOutputsConflict(ctx, node);
  }

  // Loop B — gated; interleaves agent-missing-outputs + 3 interactive helpers.
  if (ctx.dotDir) {
    for (const node of ctx.graph.nodes.values()) {
      checkAgentMissingOutputs(ctx, node);
      checkModelRequired(ctx, node);
      interactive.checkLoopRequiresDoneField(ctx, node);
      interactive.checkInteractiveWithOutputs(ctx, node);
      interactive.checkInteractiveWithLoop(ctx, node);
    }
  }

  // Loop C — long inputs-decl per-node body.
  if (ctx.dotDir) {
    for (const node of ctx.graph.nodes.values()) {
      checkInputsForNode(ctx, node);
    }
  }

  // Block D — non-loop calls.
  if (ctx.dotDir) {
    checkMissingInputProducer(ctx);
    checkInputTypeMismatch(ctx);
    checkGateUnknownSourceNode(ctx);
    checkGateSourceMissingOutputKey(ctx);
    checkOrphanOutput(ctx);
    checkOutputsSchemaShape(ctx);
  }
}

function checkAgentOutputsConflict(ctx: ValidationContext, node: Node): void {
  if (!node.agent) return;

  // When dotDir is undefined we cannot locate a sibling agent file;
  // tryResolveAgent returns undefined and this rule skips.
  const agentConfig = tryResolveAgent(node, ctx.dotDir);
  if (!agentConfig) return; // unresolvable agent — handled by other rules
  if (!agentConfig.outputs) return;

  // outputs_and_schema_file_conflict — agent outputs + json_schema_file are mutually exclusive
  if (node.jsonSchemaFile) {
    ctx.diags.push({
      rule: "outputs_and_schema_file_conflict",
      severity: "error",
      message: `Agent "${node.agent}" declares outputs in frontmatter; node also sets json_schema_file=. Remove json_schema_file= (and delete the orphaned schema file).`,
      location: node.sourceLocation,
    });
  }

  // produces_redundant_with_outputs — outputs: is SSoT; any produces= on an
  // outputs-bearing node is redundant or divergent. Escalated to error per D2.
  if (typeof node.produces === "string" && node.produces.trim().length > 0) {
    const declared = new Set(Object.keys(agentConfig.outputs));
    const onNode = node.produces.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
    if (onNode.length === 0) return;
    const extra = onNode.filter(k => !declared.has(k));
    const missing = [...declared].filter(k => !onNode.includes(k));
    let detail: string;
    if (extra.length === 0 && missing.length === 0) {
      detail = `keys are identical to outputs: — drop produces= entirely.`;
    } else if (extra.length > 0 && missing.length === 0) {
      detail = `produces= adds keys the agent does not output: ${extra.join(", ")}.`;
    } else if (missing.length > 0 && extra.length === 0) {
      detail = `produces= only declares [${onNode.join(", ")}] but agent outputs [${[...declared].join(", ")}]; missing: ${missing.join(", ")}.`;
    } else {
      detail = `produces= diverges from outputs: extra=[${extra.join(", ")}], missing=[${missing.join(", ")}].`;
    }
    ctx.diags.push({
      rule: "produces_redundant_with_outputs",
      severity: "error",
      message: `Agent "${node.agent}" declares outputs: in frontmatter (the SSoT). ${detail} Remove produces= from this node.`,
      location: node.sourceLocation,
    });
  }
}

function checkAgentMissingOutputs(ctx: ValidationContext, node: Node): void {
  if (!node.agent) return;

  // Interactive agents are exempt — they produce chat.output implicitly.
  if (isInteractiveAgent(node)) return;

  const agentConfig = tryResolveAgent(node, ctx.dotDir);
  if (!agentConfig) return; // unresolvable agent — other rules handle this

  if (agentConfig.outputs === undefined || agentConfig.outputs === null) {
    ctx.diags.push({
      rule: "agent_missing_outputs",
      severity: "error",
      message: `Agent "${node.agent}" at node "${node.id}" declares no outputs: block. Add outputs: to the agent frontmatter (or use json_schema_file= on the node for legacy agents that predate the outputs: convention).`,
      location: node.sourceLocation,
    });
    return;
  }

  if (typeof agentConfig.outputs === "object" && Object.keys(agentConfig.outputs).length === 0) {
    // When loop:true, loop_missing_done_field handles this case with a stronger error.
    if (agentConfig.loop === true) return;
    ctx.diags.push({
      rule: "agent_outputs_empty",
      severity: "warning",
      message: `Agent "${node.agent}" at node "${node.id}" has outputs: {} with no keys. Declare at least one output key, or remove outputs: if this agent intentionally produces nothing.`,
      location: node.sourceLocation,
    });
  }
}

function checkInputsForNode(ctx: ValidationContext, node: Node): void {
  const { graph, dotDir, callerInputs, traversal } = ctx;
  const { nodes } = graph;

  if (!node.agent) return;
  const cfg = tryResolveAgent(node, dotDir);
  if (!cfg) return;
  if (cfg.inputs === undefined) {
    ctx.diags.push({
      rule: "inputs_missing_frontmatter",
      severity: "error",
      message: `Agent "${node.agent}" is missing required \`inputs:\` declaration. Use \`inputs: []\` if no inputs are needed.`,
      location: node.sourceLocation,
    });
  }
  // steering_has_var_token — steering must be pure prose (no $var tokens)
  if (node.prompt) {
    const steeringVarRe = new RegExp(VAR_RE.source, VAR_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = steeringVarRe.exec(node.prompt)) !== null) {
      ctx.diags.push({
        rule: "steering_has_var_token",
        severity: "error",
        message: `steering text contains $${m[1]} — under auto_inputs, steering is pure prose`,
        location: node.sourceLocation,
      });
    }
  }

  if (Array.isArray(cfg.inputs)) {
    // rendered_tag_collision — detect two decls that map to the same XML tag
    const seenTags = new Map<string, string>();
    for (const decl of cfg.inputs) {
      let r;
      try { r = resolveInputDecl(decl); } catch { continue; }
      const prev = seenTags.get(r.renderedTag);
      if (prev !== undefined) {
        ctx.diags.push({
          rule: "rendered_tag_collision",
          severity: "error",
          message: `Input "${prev}" and "${decl}" both render as <${r.renderedTag}> — rename one to avoid a silent XML block collision`,
          location: node.sourceLocation,
        });
      } else {
        seenTags.set(r.renderedTag, decl);
      }
    }

    for (const decl of cfg.inputs) {
      let resolved;
      try {
        resolved = resolveInputDecl(decl);
      } catch {
        // Malformed decl (e.g. multi-dot key, empty string) — skip here;
        // a dedicated rule can flag these without crashing the validator.
        continue;
      }
      if (resolved.sourceNode === undefined) {
        // Short-circuit legitimate bare inputs (caller-vars, reserved) — these
        // never trigger the qualified-producer rule.
        if (callerInputs.has(resolved.localKey) || SYSTEM_VARS.has(resolved.localKey)) {
          continue;
        }

        // bare_input_from_qualified_producer — bare input is not caller/reserved
        // and an upstream produces_from_stdout tool node exists on the path.
        // The bare key cannot resolve (producer writes `${nodeId}.key`).
        // default_* does NOT silence this — bare keys cannot read qualified outputs.
        const qualifiedProducer = traversal.findQualifiedProducer(node.id);
        if (qualifiedProducer !== undefined) {
          ctx.diags.push({
            rule: "bare_input_from_qualified_producer",
            severity: "error",
            message: `Input "${resolved.localKey}" at "${node.id}" is bare but its only upstream producer "${qualifiedProducer}" emits qualified keys via produces_from_stdout. Declare as "${qualifiedProducer}.${resolved.localKey}". The default_${resolved.localKey} attribute does not silence this error — bare keys cannot read qualified producer outputs.`,
            location: node.sourceLocation,
          });
          continue;
        }

        // bare_input_not_in_caller_inputs_or_system — fallback existing rule
        if (!traversal.hasDefault(node, resolved.localKey)) {
          ctx.diags.push({
            rule: "bare_input_not_in_caller_inputs_or_system",
            severity: "error",
            message: `Agent "${node.agent}" requires bare input "${resolved.localKey}" but it is neither declared in the digraph's inputs="..." nor a system-injected var. Add it to inputs="...", qualify it as "<source_node>.${resolved.localKey}", or set default_${resolved.localKey}= on this node.`,
            location: node.sourceLocation,
          });
        }
        continue;
      }

      if (!nodes.has(resolved.sourceNode)) {
        ctx.diags.push({
          rule: "unknown_source_node",
          severity: "error",
          message: `Agent "${node.agent}" references source node "${resolved.sourceNode}" in inputs:, but no such node exists in the graph.`,
          location: node.sourceLocation,
        });
        continue;
      }

      // source_missing_output_key — source node exists but doesn't declare the requested key
      const sourceNode = nodes.get(resolved.sourceNode);
      if (!sourceNode) continue; // unreachable but keeps TS happy
      if (sourceNode.type === "tool") {
        // Tool nodes: producesFromStdout must be set (truthy) for any key to be valid.
        // The field merges stdout JSON into context but doesn't name specific keys —
        // so we flag if producesFromStdout is absent/false entirely.
        if (!sourceNode.producesFromStdout) {
          ctx.diags.push({
            rule: "source_missing_output_key",
            severity: "error",
            message: `Input "${decl}" references key "${resolved.localKey}" which "${resolved.sourceNode}" does not declare in produces_from_stdout`,
            location: node.sourceLocation,
          });
        }
      } else if (sourceNode.agent) {
        const sourceCfg = tryResolveAgent(sourceNode, dotDir);
        if (sourceCfg && sourceCfg.outputs !== undefined) {
          if (!(resolved.localKey in sourceCfg.outputs)) {
            ctx.diags.push({
              rule: "source_missing_output_key",
              severity: "error",
              message: `Input "${decl}" references key "${resolved.localKey}" which "${resolved.sourceNode}" does not declare in outputs:`,
              location: node.sourceLocation,
            });
          }
        }
      }
    }
  }
}

function checkMissingInputProducer(ctx: ValidationContext): void {
  const { graph, nodeProduces, dotDir } = ctx;
  const RESERVED = new Set(["goal", "project", "run_id"]);
  const varsInScope = computeVarsInScope(graph, nodeProduces);
  const varsInAnyScope = computeVarsInAnyScope(graph, nodeProduces);

  // Find start node id for per-path reachability checks
  const startNodeId = [...graph.nodes.values()].find(
    n => n.shape === "Mdiamond" || n.id === "start",
  )?.id;

  for (const [id, node] of graph.nodes) {
    if (!node.agent) continue;
    const agentConfig = tryResolveAgent(node, dotDir);
    if (!agentConfig || !agentConfig.inputs) continue;
    const scope = varsInScope.get(id) ?? new Set<string>();
    const anyScope = varsInAnyScope.get(id) ?? new Set<string>();
    for (const inputKey of agentConfig.inputs) {
      if (RESERVED.has(inputKey)) continue;

      // Qualified inputs need per-path source-node reachability.
      let resolved: ReturnType<typeof resolveInputDecl> | undefined;
      try { resolved = resolveInputDecl(inputKey); } catch { continue; }

      if (resolved.qualified && resolved.sourceNode) {
        // Check for default fallback: default_<localKey>= on the consumer node
        const fallbackAttrCamel = toCamel(resolved.fallbackAttr);
        if (node[fallbackAttrCamel] !== undefined) continue;

        // Source node must exist in the graph (unknown_source_node rule handles the
        // case where it doesn't — we skip here to avoid duplicate errors).
        if (!graph.nodes.has(resolved.sourceNode)) continue;

        // Check that the source node is on every path from start to consumer.
        if (startNodeId === undefined) continue;
        if (!isProducerOnEveryPath(graph, startNodeId, id, resolved.sourceNode)) {
          ctx.diags.push({
            rule: "missing_input_producer",
            severity: "error",
            message: `Input "${inputKey}" declared by "${id}" has no producer on path start → … → ${id}. Node "${resolved.sourceNode}" must be on every path from start to "${id}".`,
            location: node.sourceLocation,
          });
        }
        continue; // handled — skip bare-key logic below
      }

      // Bare-key path: existing behavior (unchanged)
      if (scope.has(inputKey)) continue;
      if (anyScope.has(inputKey)) {
        ctx.diags.push({
          rule: "branch_incomplete_input",
          severity: "error",
          message: `Agent "${node.agent}" at node "${id}" requires input "${inputKey}" but only some upstream paths produce it. Either ensure every path produces "${inputKey}" before reaching this node, or declare default_${inputKey}= on this node as a fallback.`,
          location: node.sourceLocation,
        });
      } else {
        ctx.diags.push({
          rule: "missing_input_producer",
          severity: "error",
          message: `Agent "${node.agent}" at node "${id}" requires input "${inputKey}" but no upstream node produces it on every path. Either route through a producer, declare default_${inputKey}= on this node, or add "${inputKey}" to the digraph's inputs="..." for caller-supplied vars.`,
          location: node.sourceLocation,
        });
      }
    }
  }
}

function checkInputTypeMismatch(ctx: ValidationContext): void {
  const { graph, dotDir } = ctx;
  // Collect every (nodeId, key, enum[]) tuple declared in agent frontmatter.
  // The check is global across the graph: if any agent declares enum for a key
  // and a condition uses a value outside that enum, it's a typo.
  type EnumDecl = { nodeId: string; agent: string; enums: string[] };
  const enumsByKey = new Map<string, EnumDecl[]>();
  for (const [id, node] of graph.nodes) {
    if (!node.agent) continue;
    const cfg = tryResolveAgent(node, dotDir);
    if (!cfg?.outputs) continue;
    for (const [key, frag] of Object.entries(cfg.outputs)) {
      if (typeof frag !== "object" || frag === null) continue;
      const e = (frag as { enum?: unknown }).enum;
      if (!Array.isArray(e) || e.length === 0) continue;
      const enums = e.filter((v): v is string => typeof v === "string");
      if (enums.length === 0) continue;
      const arr = enumsByKey.get(key) ?? [];
      arr.push({ nodeId: id, agent: String(node.agent), enums });
      enumsByKey.set(key, arr);
    }
  }
  if (enumsByKey.size === 0) return;

  for (const edge of graph.edges) {
    if (!edge.condition) continue;
    const clauses = parseConditionClauses(String(edge.condition));
    for (const clause of clauses) {
      if (clause.key === "outcome") continue;
      const decls = enumsByKey.get(clause.key);
      if (!decls || decls.length === 0) continue;
      // A clause is valid if at least one declaring agent's enum accepts the value.
      if (decls.some(d => d.enums.includes(clause.val))) continue;
      const first = decls[0];
      ctx.diags.push({
        rule: "input_type_mismatch",
        severity: "error",
        message: `Edge "${edge.from}" -> "${edge.to}" condition uses "${clause.key}${clause.op}${clause.val}" but agent "${first.agent}" declares outputs.${clause.key}.enum=[${first.enums.map(v => `"${v}"`).join(", ")}]; "${clause.val}" is not a member. Fix the condition value or update the enum.`,
        location: edge.sourceLocation,
      });
    }
  }
}

function checkOrphanOutput(ctx: ValidationContext): void {
  const { graph } = ctx;
  const dotDir = ctx.dotDir!;
  // Build the set of keys consumed anywhere in the graph: downstream agent
  // inputs:, edge condition= clauses, and $key references in prompts/labels.
  const consumed = new Set<string>();

  for (const [, node] of graph.nodes) {
    if (node.agent) {
      const cfg = tryResolveAgent(node, dotDir);
      if (!cfg?.inputs) continue;
      for (const k of cfg.inputs) {
        // Resolve qualified inputs (e.g. "verifier.summary") to their localKey ("summary")
        // so they register as consuming the producer's output.
        try {
          const resolved = resolveInputDecl(k);
          consumed.add(resolved.localKey);
        } catch {
          // Malformed input decl — skip silently (other rules handle the error).
        }
      }
    }
  }
  // Gate-input contribution via shared helper — preserves emission order with
  // the agent-branch loop above (loop runs to completion first).
  iterateGateInputs(ctx, ({ resolved }) => {
    consumed.add(resolved.localKey);
  });

  for (const edge of graph.edges) {
    if (!edge.condition) continue;
    const clauses = parseConditionClauses(String(edge.condition));
    for (const clause of clauses) {
      consumed.add(clause.key);
      // Also register the localKey portion of qualified keys (e.g. "verifier.preferred_label" → "preferred_label")
      if (isQualifiedKey(clause.key)) {
        consumed.add(clause.key.slice(clause.key.indexOf(".") + 1));
      }
    }
  }

  const VAR_RE_LOCAL = /\$([a-zA-Z_][\w.]*)/g;
  for (const node of graph.nodes.values()) {
    const fields = STRING_ATTRS
      .map((attr) => (node as Record<string, unknown>)[attr])
      .filter((f): f is string => typeof f === "string");
    for (const field of fields) {
      let m: RegExpExecArray | null;
      const re = new RegExp(VAR_RE_LOCAL.source, VAR_RE_LOCAL.flags);
      while ((m = re.exec(field)) !== null) {
        const ref = m[1].replace(/\.+$/, "");
        consumed.add(ref);
        // Qualified ref ($node.key) — also register the localKey so the
        // producing node's bare-key output is recognized as consumed.
        const dot = ref.indexOf(".");
        if (dot !== -1) consumed.add(ref.slice(dot + 1));
      }
    }
  }

  for (const [id, node] of graph.nodes) {
    if (!node.agent) continue;
    const cfg = tryResolveAgent(node, dotDir);
    if (!cfg?.outputs) continue;
    for (const key of Object.keys(cfg.outputs)) {
      if (consumed.has(key)) continue;
      // loop: true agents require a "done" field — it is consumed internally by the
      // loop-retry mechanism (condition="<nodeId>.success=false"), not by downstream agents.
      // Don't warn about this mandatory sentinel key being unconsumed externally.
      if (key === "done" && cfg.loop === true) continue;
      ctx.diags.push({
        rule: "orphan_output",
        severity: "warning",
        message: `Agent "${node.agent}" at node "${id}" declares output "${key}" but no downstream node consumes it (no agent input, condition=, or $${key} reference). Drop "${key}" from outputs: or wire it into a consumer.`,
        location: node.sourceLocation,
      });
    }
  }
}

function checkOutputsSchemaShape(ctx: ValidationContext): void {
  const { graph, dotDir } = ctx;
  for (const [id, node] of graph.nodes) {
    if (!node.agent) continue;
    const cfg = tryResolveAgent(node, dotDir);
    if (!cfg?.outputs) continue;
    try {
      outputsToZod(cfg.outputs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.diags.push({
        rule: "outputs_schema_invalid",
        severity: "error",
        message: `Agent "${node.agent}" at node "${id}" has an invalid outputs: shape — ${msg} This will crash at runtime when the node fires.`,
        location: node.sourceLocation,
      });
    }
  }
}

/**
 * Returns true iff every path from `start` to `target` passes through `producer`.
 * Equivalent to: producer is a dominator of target on the start→target subgraph.
 *
 * Strategy: if we can reach `target` from `start` without visiting `producer`,
 * then producer is NOT on every path → return false. Otherwise true.
 */
function isProducerOnEveryPath(
  graph: Graph,
  start: string,
  target: string,
  producer: string,
): boolean {
  if (producer === start) return true; // start itself produces — trivially true
  if (producer === target) return true; // producer === consumer — degenerate, skip

  // Build forward adjacency (shared primitive — see dot-common.ts).
  const fwd = buildForwardAdj(graph);

  // BFS from start, excluding producer — if we can still reach target, producer
  // is NOT on every path.
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === target) return false; // reached target without going through producer
    for (const next of fwd.get(cur) ?? []) {
      if (next !== producer) queue.push(next); // skip producer node
    }
  }
  // Cannot reach target without producer → producer dominates target
  return true;
}

function checkGateUnknownSourceNode(ctx: ValidationContext): void {
  iterateGateInputs(ctx, ({ gateNodeId, resolved, gateNode }) => {
    if (resolved.sourceNode === undefined) return;
    if (ctx.graph.nodes.has(resolved.sourceNode)) return;
    ctx.diags.push({
      rule: "unknown_source_node",
      severity: "error",
      message: `Gate "${gateNodeId}" references source node "${resolved.sourceNode}" in inputs:, but no such node exists in the graph.`,
      location: gateNode.sourceLocation,
    });
  });
}

function checkGateSourceMissingOutputKey(ctx: ValidationContext): void {
  const { dotDir, graph } = ctx;
  iterateGateInputs(ctx, ({ gateNodeId, decl, resolved, gateNode }) => {
    if (resolved.sourceNode === undefined) return;
    const source = graph.nodes.get(resolved.sourceNode);
    if (!source) return; // unknown_source_node handles this
    if (source.type === "tool") {
      if (!source.producesFromStdout) {
        ctx.diags.push({
          rule: "source_missing_output_key",
          severity: "error",
          message: `Gate "${gateNodeId}" input "${decl}" references key "${resolved.localKey}" which "${resolved.sourceNode}" does not declare in produces_from_stdout`,
          location: gateNode.sourceLocation,
        });
      }
      return;
    }
    if (source.agent) {
      const sourceCfg = tryResolveAgent(source, dotDir);
      if (!sourceCfg || sourceCfg.outputs === undefined) return;
      if (!(resolved.localKey in sourceCfg.outputs)) {
        ctx.diags.push({
          rule: "source_missing_output_key",
          severity: "error",
          message: `Gate "${gateNodeId}" input "${decl}" references key "${resolved.localKey}" which "${resolved.sourceNode}" does not declare in outputs:`,
          location: gateNode.sourceLocation,
        });
      }
    }
  });
}

/**
 * Walk every hexagon-gate node's frontmatter `inputs:` declarations,
 * invoking `callback` once per (gateNode, decl, resolved) triple.
 *
 * Silently skips gates whose .md is missing/unparseable (`resolveGate` throws)
 * or whose individual decl is malformed (`resolveInputDecl` throws) — other
 * rules surface those errors.
 */
interface GateInputVisit {
  gateNodeId: string;
  decl: string;
  resolved: ReturnType<typeof resolveInputDecl>;
  gateNode: Node;
}

function iterateGateInputs(
  ctx: ValidationContext,
  callback: (v: GateInputVisit) => void,
): void {
  const { graph, dotDir } = ctx;
  if (!dotDir) return;
  for (const [id, node] of graph.nodes) {
    if (node.shape !== "hexagon") continue;
    let gateCfg;
    try {
      gateCfg = resolveGate(id, { dotDir });
    } catch {
      continue;
    }
    if (!gateCfg?.inputs) continue;
    for (const decl of gateCfg.inputs) {
      let resolved;
      try {
        resolved = resolveInputDecl(decl);
      } catch {
        continue;
      }
      callback({ gateNodeId: id, decl, resolved, gateNode: node });
    }
  }
}
