import { existsSync } from "fs";
import { resolve as resolvePath, extname, join } from "path";
import type { Graph, Node, Diagnostic } from "../types.js";
import { expandVariables, extractDefaults, UndefinedVariableError, STRING_ATTRS } from "../transforms/variable-expansion.js";
import { validateNode } from "./schemas.js";
import {
  toCamel,
  buildForwardAdj,
} from "./dot-common.js";
import { loadAgent } from "../../cli/lib/agent-loader.js";
import type { AgentConfig } from "../../cli/lib/agent.js";
import { computeVarsInScope, computeVarsInAnyScope } from "./flow-analyzer.js";
import { parseConditionClauses } from "./conditions.js";
import { resolveGate } from "../../cli/lib/gate-registry.js";
import { resolveInputDecl } from "../transforms/inputs-resolver.js";
import { SYSTEM_INJECTED_VARS } from "../handlers/agent-prep.js";
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { KNOWN_TYPES, UNIMPLEMENTED_TYPES, isInteractiveAgent, resolveHandlerType } from "./graph.js";
import { createValidationContext, RESERVED_VARS, type ValidationContext } from "./validators/context.js";

const SYSTEM_VARS = new Set<string>(SYSTEM_INJECTED_VARS);

function isQualifiedKey(key: string): boolean {
  return key.includes(".");
}

const SUPPORTED_SCRIPT_EXTS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".sh", ".bash", ".py"];

const INLINE_SCRIPT_PATTERNS: RegExp[] = [
  /\bnode\s+-e\b/,
  /\bpython[23]?\s+-c\b/,
  /\bbash\s+-c\b/,
  /<<\s*['"]?[A-Z]/, // heredoc marker
];

export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
  const ctx = createValidationContext(graph, dotDir);
  const { traversal, nodeProduces, callerInputs } = ctx;
  const diags: Diagnostic[] = ctx.diags;
  for (const node of graph.nodes.values()) {
    diags.push(...validateNode(node));
  }
  const { nodes, edges } = graph;

  const isStart = (n: Node) => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start";
  const isExit  = (n: Node) => n.shape === "Msquare"  || n.id === "exit"  || n.id === "end";

  const startNodes = [...nodes.values()].filter(isStart);
  const exitNodes  = [...nodes.values()].filter(isExit);

  if (startNodes.length !== 1) diags.push({ rule: "start_node", severity: "error", message: `Expected exactly 1 start node, found ${startNodes.length}` });
  if (exitNodes.length !== 1)  diags.push({ rule: "terminal_node", severity: "error", message: `Expected exactly 1 exit node, found ${exitNodes.length}` });

  // Reachability BFS from start
  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0].id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of edges.filter(e => e.from === cur)) queue.push(e.to);
    }
    for (const id of nodes.keys()) {
      if (!reachable.has(id)) diags.push({ rule: "reachability", severity: "error", message: `Node "${id}" is unreachable from start`, location: nodes.get(id)?.sourceLocation });
    }

    // start has no incoming
    if (edges.some(e => e.to === startNodes[0].id)) {
      diags.push({ rule: "start_no_incoming", severity: "error", message: "Start node must not have incoming edges", location: startNodes[0].sourceLocation });
    }
  }

  // exit has no outgoing
  if (exitNodes.length === 1 && edges.some(e => e.from === exitNodes[0].id)) {
    diags.push({ rule: "exit_no_outgoing", severity: "error", message: "Exit node must not have outgoing edges", location: exitNodes[0].sourceLocation });
  }

  // Reverse-BFS from exit: every non-exit node must be able to reach the exit.
  // Catches dead-end authoring bugs (e.g. a gate branch points at a node with
  // no outgoing edges) that forward-reachability alone cannot see.
  if (exitNodes.length === 1) {
    const exitId = exitNodes[0].id;
    const reverseAdj = new Map<string, string[]>();
    for (const id of nodes.keys()) reverseAdj.set(id, []);
    for (const e of edges) {
      if (reverseAdj.has(e.to)) reverseAdj.get(e.to)!.push(e.from);
    }
    const reachesExit = new Set<string>();
    const queue = [exitId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachesExit.has(cur)) continue;
      reachesExit.add(cur);
      for (const pred of (reverseAdj.get(cur) ?? [])) queue.push(pred);
    }
    for (const [id, node] of nodes) {
      if (isExit(node)) continue;
      if (!reachesExit.has(id)) {
        diags.push({
          rule: "reaches_exit",
          severity: "error",
          message: `Node "${id}" has no path to the exit node`,
          location: node.sourceLocation,
        });
      }
    }
  }

  // Edge targets exist
  for (const e of edges) {
    if (!nodes.has(e.to)) diags.push({ rule: "edge_target_exists", severity: "error", message: `Edge target "${e.to}" not declared`, location: e.sourceLocation });
    if (!nodes.has(e.from)) diags.push({ rule: "edge_source_exists", severity: "error", message: `Edge source "${e.from}" not declared`, location: e.sourceLocation });
  }

  // Condition syntax (basic: only allow key=value and key!=value with &&)
  for (const e of edges) {
    if (e.condition) {
      const valid = /^[\w.'= !&\s]+$/.test(e.condition) && !/==|=>|<=/.test(e.condition);
      if (!valid) diags.push({ rule: "condition_syntax", severity: "error", message: `Invalid condition syntax: "${e.condition}"`, location: e.sourceLocation });
    }
  }

  // type_known warning + unimplemented type errors
  for (const node of nodes.values()) {
    const t = resolveHandlerType(node);
    if (!KNOWN_TYPES.has(t)) diags.push({ rule: "type_known", severity: "warning", message: `Unknown handler type "${t}" on node "${node.id}"`, location: node.sourceLocation });
    if (UNIMPLEMENTED_TYPES.has(t)) diags.push({ rule: "type_unsupported", severity: "error", message: `Node type "${t}" is declared but not yet implemented (node "${node.id}")`, location: node.sourceLocation });
  }

  // variable_coverage — warn when a $variable may not be defined on all paths
  const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;

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

  // Script-file + inline-script rules (tool-handler nodes only)
  for (const node of nodes.values()) {
    if (resolveHandlerType(node) !== "tool") continue;

    const scriptFile = typeof node.scriptFile === "string" ? node.scriptFile : undefined;
    const toolCommand = typeof node.toolCommand === "string" ? node.toolCommand : undefined;

    // script_command_conflict — mutually exclusive
    if (scriptFile && toolCommand) {
      diags.push({
        rule: "script_command_conflict",
        severity: "error",
        message: `script_file= and tool_command= are mutually exclusive.`,
        location: node.sourceLocation,
      });
    }

    if (scriptFile) {
      // unsupported_script_extension
      const ext = extname(scriptFile).toLowerCase();
      if (!SUPPORTED_SCRIPT_EXTS.includes(ext)) {
        diags.push({
          rule: "unsupported_script_extension",
          severity: "error",
          message:
            `Unsupported script extension: ${ext}. ` +
            `Supported: ${SUPPORTED_SCRIPT_EXTS.join(", ")}.`,
          location: node.sourceLocation,
        });
      }

      // script_file_exists — only when dotDir is available
      if (dotDir) {
        const resolved = resolvePath(dotDir, scriptFile);
        if (!existsSync(resolved)) {
          diags.push({
            rule: "script_file_exists",
            severity: "error",
            message: `script_file= references a path that doesn't exist: ${resolved}`,
            location: node.sourceLocation,
          });
        }
      }
    }

    // inline_script_smell — heuristics on tool_command=
    if (toolCommand) {
      let flagged = false;
      for (const re of INLINE_SCRIPT_PATTERNS) {
        if (re.test(toolCommand)) { flagged = true; break; }
      }
      if (!flagged) {
        // Length check AFTER attempting variable expansion against EMPTY context
        // so $foo literals retain full length (avoids false negatives when vars
        // expand to short strings at runtime).
        let probed = toolCommand;
        try {
          probed = expandVariables(toolCommand, {}, extractDefaults(node));
        } catch (e) {
          if (!(e instanceof UndefinedVariableError)) throw e;
          // Keep `probed = toolCommand` (literal length) — matches the spec's
          // "apply AFTER attempting variable expansion" semantics.
        }
        if (probed.length > 120) flagged = true;
      }
      if (flagged) {
        diags.push({
          rule: "inline_script_smell",
          severity: "warning",
          message:
            `Inline script in tool_command= is fragile under DOT quoting. ` +
            `Move to <pipeline-folder>/<name>.<ext> and use script_file=.`,
          location: node.sourceLocation,
        });
      }
    }
  }

  // agent outputs conflict checks — outputs_and_schema_file_conflict + produces_redundant_with_outputs
  for (const node of nodes.values()) {
    checkAgentOutputsConflict(node, dotDir, diags);
  }

  // agent_missing_outputs + agent_outputs_empty — only when dotDir is available for resolution
  if (dotDir) {
    for (const node of nodes.values()) {
      checkAgentMissingOutputs(node, dotDir, diags);
      checkLoopRequiresDoneField(node, dotDir, diags);
      checkInteractiveWithOutputs(node, dotDir, diags);
      checkInteractiveWithLoop(node, dotDir, diags);
    }
  }

  // inputs_missing_frontmatter — auto_inputs: true requires explicit inputs: declaration
  // unknown_source_node — qualified inputs must reference existing graph nodes
  if (dotDir) {
    for (const node of nodes.values()) {
      if (!node.agent) continue;
      const cfg = tryResolveAgent(node, dotDir);
      if (!cfg) continue;
      if (cfg.inputs === undefined) {
        diags.push({
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
          diags.push({
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
            diags.push({
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
              diags.push({
                rule: "bare_input_from_qualified_producer",
                severity: "error",
                message: `Input "${resolved.localKey}" at "${node.id}" is bare but its only upstream producer "${qualifiedProducer}" emits qualified keys via produces_from_stdout. Declare as "${qualifiedProducer}.${resolved.localKey}". The default_${resolved.localKey} attribute does not silence this error — bare keys cannot read qualified producer outputs.`,
                location: node.sourceLocation,
              });
              continue;
            }

            // bare_input_not_in_caller_inputs_or_system — fallback existing rule
            if (!traversal.hasDefault(node, resolved.localKey)) {
              diags.push({
                rule: "bare_input_not_in_caller_inputs_or_system",
                severity: "error",
                message: `Agent "${node.agent}" requires bare input "${resolved.localKey}" but it is neither declared in the digraph's inputs="..." nor a system-injected var. Add it to inputs="...", qualify it as "<source_node>.${resolved.localKey}", or set default_${resolved.localKey}= on this node.`,
                location: node.sourceLocation,
              });
            }
            continue;
          }

          if (!nodes.has(resolved.sourceNode)) {
            diags.push({
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
              diags.push({
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
                diags.push({
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
  }

  // loadAgent needs the pipeline directory to locate sibling agent files; without dotDir we can't fetch agent configs.
  if (dotDir) {
    checkMissingInputProducer(graph, nodeProduces, dotDir, diags);
    checkInputTypeMismatch(graph, dotDir, diags);
    checkOrphanOutput(graph, dotDir, diags);
    checkOutputsSchemaShape(graph, dotDir, diags);
  }

  // required_caller_vars — info banner listing vars that must be supplied via --var
  checkRequiredCallerVars(graph, nodeProduces, dotDir, diags);

  if (dotDir) checkGateHandlers(graph, dotDir, diags);

  return diags;
}

function checkOrphanOutput(
  graph: Graph,
  dotDir: string,
  diags: Diagnostic[],
): void {
  // Build the set of keys consumed anywhere in the graph: downstream agent
  // inputs:, edge condition= clauses, and $key references in prompts/labels.
  const consumed = new Set<string>();

  for (const [id, node] of graph.nodes) {
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
    } else if (node.shape === "hexagon") {
      // Gate nodes can also consume outputs via their inputs: frontmatter.
      try {
        const gateCfg = resolveGate(id, { dotDir });
        if (gateCfg?.inputs) {
          for (const k of gateCfg.inputs) {
            try {
              const resolved = resolveInputDecl(k);
              consumed.add(resolved.localKey);
            } catch {
              // Malformed input decl — skip silently.
            }
          }
        }
      } catch {
        // Gate not found or parse error — skip silently (other rules handle this).
      }
    }
  }

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
      diags.push({
        rule: "orphan_output",
        severity: "warning",
        message: `Agent "${node.agent}" at node "${id}" declares output "${key}" but no downstream node consumes it (no agent input, condition=, or $${key} reference). Drop "${key}" from outputs: or wire it into a consumer.`,
        location: node.sourceLocation,
      });
    }
  }
}

function checkOutputsSchemaShape(
  graph: Graph,
  dotDir: string,
  diags: Diagnostic[],
): void {
  for (const [id, node] of graph.nodes) {
    if (!node.agent) continue;
    const cfg = tryResolveAgent(node, dotDir);
    if (!cfg?.outputs) continue;
    try {
      outputsToZod(cfg.outputs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diags.push({
        rule: "outputs_schema_invalid",
        severity: "error",
        message: `Agent "${node.agent}" at node "${id}" has an invalid outputs: shape — ${msg} This will crash at runtime when the node fires.`,
        location: node.sourceLocation,
      });
    }
  }
}

function checkInputTypeMismatch(
  graph: Graph,
  dotDir: string,
  diags: Diagnostic[],
): void {
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
      diags.push({
        rule: "input_type_mismatch",
        severity: "error",
        message: `Edge "${edge.from}" -> "${edge.to}" condition uses "${clause.key}${clause.op}${clause.val}" but agent "${first.agent}" declares outputs.${clause.key}.enum=[${first.enums.map(v => `"${v}"`).join(", ")}]; "${clause.val}" is not a member. Fix the condition value or update the enum.`,
        location: edge.sourceLocation,
      });
    }
  }
}

function tryResolveAgent(node: Node, dotDir: string | undefined): AgentConfig | undefined {
  if (!node.agent || !dotDir) return undefined;
  try {
    return loadAgent(node.agent as string, dotDir);
  } catch {
    return undefined;
  }
}

function checkRequiredCallerVars(
  graph: Graph,
  nodeProduces: Map<string, Set<string>>,
  dotDir: string | undefined,
  diags: Diagnostic[],
): void {
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

function checkMissingInputProducer(
  graph: Graph,
  nodeProduces: Map<string, Set<string>>,
  dotDir: string,
  diags: Diagnostic[],
): void {
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
          diags.push({
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
        diags.push({
          rule: "branch_incomplete_input",
          severity: "error",
          message: `Agent "${node.agent}" at node "${id}" requires input "${inputKey}" but only some upstream paths produce it. Either ensure every path produces "${inputKey}" before reaching this node, or declare default_${inputKey}= on this node as a fallback.`,
          location: node.sourceLocation,
        });
      } else {
        diags.push({
          rule: "missing_input_producer",
          severity: "error",
          message: `Agent "${node.agent}" at node "${id}" requires input "${inputKey}" but no upstream node produces it on every path. Either route through a producer, declare default_${inputKey}= on this node, or add "${inputKey}" to the digraph's inputs="..." for caller-supplied vars.`,
          location: node.sourceLocation,
        });
      }
    }
  }
}

function checkAgentOutputsConflict(
  node: Node,
  dotDir: string | undefined,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;

  // When dotDir is undefined we cannot locate a sibling agent file;
  // tryResolveAgent returns undefined and this rule skips.
  const agentConfig = tryResolveAgent(node, dotDir);
  if (!agentConfig) return; // unresolvable agent — handled by other rules
  if (!agentConfig.outputs) return;

  // outputs_and_schema_file_conflict — agent outputs + json_schema_file are mutually exclusive
  if (node.jsonSchemaFile) {
    diags.push({
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
    diags.push({
      rule: "produces_redundant_with_outputs",
      severity: "error",
      message: `Agent "${node.agent}" declares outputs: in frontmatter (the SSoT). ${detail} Remove produces= from this node.`,
      location: node.sourceLocation,
    });
  }
}

function checkAgentMissingOutputs(
  node: Node,
  dotDir: string,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;

  // Interactive agents are exempt — they produce chat.output implicitly.
  if (isInteractiveAgent(node)) return;

  const agentConfig = tryResolveAgent(node, dotDir);
  if (!agentConfig) return; // unresolvable agent — other rules handle this

  if (agentConfig.outputs === undefined || agentConfig.outputs === null) {
    diags.push({
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
    diags.push({
      rule: "agent_outputs_empty",
      severity: "warning",
      message: `Agent "${node.agent}" at node "${node.id}" has outputs: {} with no keys. Declare at least one output key, or remove outputs: if this agent intentionally produces nothing.`,
      location: node.sourceLocation,
    });
  }
}

function checkLoopRequiresDoneField(
  node: Node,
  dotDir: string,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;
  if (isInteractiveAgent(node)) return;

  const agentConfig = tryResolveAgent(node, dotDir);
  if (!agentConfig) return;
  if (agentConfig.loop !== true) return;

  const outputs = agentConfig.outputs ?? {};
  const doneShape = (outputs as Record<string, unknown>).done;
  const ok =
    doneShape === "boolean" ||
    (typeof doneShape === "object" && doneShape !== null &&
     (doneShape as { type?: string }).type === "boolean");

  if (!ok) {
    diags.push({
      rule: "loop_missing_done_field",
      severity: "error",
      message: `Agent "${node.agent}" at node "${node.id}" declares loop:true but its outputs: lacks a done:boolean field. Add 'done: boolean' to the agent's outputs frontmatter.`,
      location: node.sourceLocation,
    });
  }
}

function checkInteractiveWithOutputs(
  node: Node,
  dotDir: string,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;
  if (!isInteractiveAgent(node)) return;
  const agentConfig = tryResolveAgent(node, dotDir);
  if (!agentConfig) return;
  const hasOutputs = !!(agentConfig.outputs && Object.keys(agentConfig.outputs).length > 0);
  if (!hasOutputs) return;
  diags.push({
    rule: "interactive_with_outputs_forbidden",
    severity: "error",
    message: `Node "${node.id}" sets interactive=true but agent "${node.agent}" declares outputs:. Remove the outputs: block from the agent frontmatter, or remove interactive=true from the node.`,
    location: node.sourceLocation,
  });
}

function checkInteractiveWithLoop(
  node: Node,
  dotDir: string,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;
  if (!isInteractiveAgent(node)) return;

  // Node-level loop signals
  const nodeLoopOn = node.loop === true || node.loop === "true";
  const nodeMaxRaw = node.maxIterations;
  const nodeMaxParsed =
    typeof nodeMaxRaw === "string" ? parseInt(nodeMaxRaw, 10)
    : typeof nodeMaxRaw === "number" ? nodeMaxRaw
    : undefined;
  const nodeMaxLoops = nodeMaxParsed != null && !isNaN(nodeMaxParsed) && nodeMaxParsed > 1;

  // Agent-level loop signals
  const agentConfig = tryResolveAgent(node, dotDir);
  const agentLoopOn = agentConfig?.loop === true;
  const agentMax = agentConfig?.maxIterations;
  const agentMaxLoops = typeof agentMax === "number" && agentMax > 1;

  if (!(nodeLoopOn || nodeMaxLoops || agentLoopOn || agentMaxLoops)) return;

  diags.push({
    rule: "interactive_with_loop_forbidden",
    severity: "error",
    message: `Node "${node.id}" sets interactive=true with looping (loop=true / maxIterations>1). Interactive sessions cannot iterate — remove loop=true / maxIterations from the node or agent, or remove interactive=true.`,
    location: node.sourceLocation,
  });
}

function checkGateHandlers(
  graph: Graph,
  dotDir: string,
  diags: Diagnostic[],
): void {
  for (const [id, node] of graph.nodes) {
    if (resolveHandlerType(node) !== "wait.human") continue;

    const hasInlineLabel = !!node.label;
    const mdPath = join(dotDir, `${id}.md`);
    const hasMdFile = existsSync(mdPath);

    if (!hasInlineLabel && !hasMdFile) {
      diags.push({
        rule: "gate_handler_missing",
        severity: "error",
        message: `Gate "${id}" has no inline label= and no sibling ${id}.md. Add either a label= attribute OR create ${id}.md with type:gate frontmatter.`,
        location: node.sourceLocation,
      });
      continue;
    }

    if (hasInlineLabel && hasMdFile) {
      diags.push({
        rule: "gate_inline_md_conflict",
        severity: "error",
        message: `Gate "${id}" has both inline label= and sibling ${id}.md. Pick one source of truth — remove the label= or delete the .md.`,
        location: node.sourceLocation,
      });
      continue;
    }

    if (!hasMdFile) continue; // inline-only path: no further checks needed

    // .md path: parse + cross-check choices vs edges
    let gate: { choices: string[] };
    try {
      gate = resolveGate(id, { dotDir });
    } catch (err) {
      diags.push({
        rule: "gate_md_parse_error",
        severity: "error",
        message: `Gate "${id}" .md failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        location: node.sourceLocation,
      });
      continue;
    }

    const outgoing = graph.edges.filter(e => e.from === id);
    const edgeLabels = outgoing.map(e => e.label).filter((l): l is string => !!l);
    const declaredSet = new Set(gate.choices);
    const edgeSet = new Set(edgeLabels);

    const declaredButNoEdge = gate.choices.filter(c => !edgeSet.has(c));
    const edgeButNotDeclared = edgeLabels.filter(l => !declaredSet.has(l));
    const unlabeledEdgeCount = outgoing.length - edgeLabels.length;

    if (declaredButNoEdge.length || edgeButNotDeclared.length || unlabeledEdgeCount > 0) {
      const parts: string[] = [];
      if (declaredButNoEdge.length) parts.push(`declared in .md but no matching edge: [${declaredButNoEdge.join(", ")}]`);
      if (edgeButNotDeclared.length) parts.push(`edge labels not in .md choices: [${edgeButNotDeclared.join(", ")}]`);
      if (unlabeledEdgeCount > 0) parts.push(`${unlabeledEdgeCount} outgoing edge(s) have no label`);
      diags.push({
        rule: "gate_choice_edge_mismatch",
        severity: "error",
        message: `Gate "${id}" choice/edge mismatch — ${parts.join("; ")}.`,
        location: node.sourceLocation,
      });
    }
  }
}

export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
