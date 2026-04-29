import { existsSync } from "fs";
import { resolve as resolvePath, extname, join } from "path";
import type { Graph, Node, Diagnostic } from "../types.js";
import { expandVariables, extractDefaults, UndefinedVariableError } from "../transforms/variable-expansion.js";
import { validateNode } from "./schemas.js";
import { parseDotV2 } from "./graph-ast.js";
import {
  toCamel,
} from "./dot-common.js";
import { resolveAgent } from "../../cli/lib/agent-registry.js";
import type { AgentConfig } from "../../cli/lib/agent.js";
import { computeVarsInScope, computeVarsInAnyScope } from "./flow-analyzer.js";
import { parseConditionClauses } from "./conditions.js";
import { resolveGate } from "../../cli/lib/gate-registry.js";
import { resolveInputDecl } from "../transforms/inputs-resolver.js";
import { SYSTEM_INJECTED_VARS } from "../handlers/agent-handler.js";

const SYSTEM_VARS = new Set<string>(SYSTEM_INJECTED_VARS);

export function parseDot(src: string): Graph {
  return parseDotV2(src);
}

const KNOWN_TYPES = new Set([
  "codergen", "tool", "wait.human", "conditional", "parallel", "parallel.fan_in",
  "start", "exit", "store",
  "ralph.implement", "ralph.meditate",
  "agent", "stack.manager_loop",
]);

// Types that pass validation but are not yet implemented — emit errors
const UNIMPLEMENTED_TYPES = new Set([
  "parallel", "parallel.fan_in",     // fan-out execution not yet implemented
  "stack.manager_loop",              // no handler registered
]);

const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start", Msquare: "exit", box: "codergen",
  hexagon: "wait.human", diamond: "conditional", component: "parallel",
  tripleoctagon: "parallel.fan_in", parallelogram: "tool", house: "stack.manager_loop",
  circle: "ralph.implement", octagon: "ralph.meditate",
  cylinder: "store",
};

export function resolveHandlerType(node: Node): string {
  if (node.agent) return "agent";
  if (node.type) return node.type;
  if (node.shape && SHAPE_TO_TYPE[node.shape]) return SHAPE_TO_TYPE[node.shape];
  return "codergen";
}

const SUPPORTED_SCRIPT_EXTS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".sh", ".bash", ".py"];

const INLINE_SCRIPT_PATTERNS: RegExp[] = [
  /\bnode\s+-e\b/,
  /\bpython[23]?\s+-c\b/,
  /\bbash\s+-c\b/,
  /<<\s*['"]?[A-Z]/, // heredoc marker
];

export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
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
  const RESERVED_VARS = new Set(["goal", "project", "run_id"]);
  const callerInputs = new Set(graph.inputs ?? []);
  const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;

  // Handler-type implicit productions
  const TYPE_PRODUCES: Record<string, string[]> = {
    "tool": ["tool.output"],
    "store": ["store.path"],
    "wait.human": ["chat.output", "choice"],
  };

  // Build adjacency list for forward BFS
  const adj = new Map<string, string[]>();
  for (const n of nodes.keys()) adj.set(n, []);
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from)!.push(e.to);
  }

  // Collect what each node produces
  const nodeProduces = new Map<string, Set<string>>();
  for (const [id, node] of nodes) {
    const produced = new Set<string>();
    const handlerType = resolveHandlerType(node);
    // Implicit productions from handler type
    if (TYPE_PRODUCES[handlerType]) {
      for (const v of TYPE_PRODUCES[handlerType]) produced.add(v);
    }
    // Gates write a node-specific choice key in addition to the alias (8cb4eef).
    if (handlerType === "wait.human") {
      produced.add(`${id}.choice`);
    }
    // Interactive nodes produce chat.output
    if (node.interactive) produced.add("chat.output");
    // Explicit produces attribute (comma-separated)
    if (typeof node.produces === "string") {
      for (const v of (node.produces as string).split(",").map(s => s.trim()).filter(Boolean)) {
        produced.add(v);
      }
    }
    // Derive produces from agent file's outputs block when dotDir is available
    if (node.agent && dotDir) {
      try {
        const agentConfig = resolveAgent(node.agent as string, { projectDir: dotDir, allowBundledFallback: false });
        if (agentConfig.outputs) {
          for (const key of Object.keys(agentConfig.outputs)) {
            produced.add(key);
          }
        }
      } catch {
        // Agent file unresolvable; do not crash the validator.
      }
    }
    nodeProduces.set(id, produced);
  }

  // Check if a node has a default for a given variable.
  // DOT `default_<var>` is normalized to camelCase at parse time via toCamel
  // (graph.ts:7). Route lookup through the same helper so snake_case var names
  // like $test_result resolve to defaultTestResult, not defaultTest_result.
  function hasDefault(node: Node, varName: string): boolean {
    const key = toCamel("default_" + varName);
    return node[key] !== undefined;
  }

  // BFS reachability check: can `target` be reached from `source` without visiting any node in `excluded`?
  function reachableWithout(source: string, target: string, excluded: Set<string>): boolean {
    if (source === target) return true;
    const visited = new Set<string>();
    const queue = [source];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (cur === target) return true;
      for (const next of (adj.get(cur) ?? [])) {
        if (!excluded.has(next)) queue.push(next);
      }
    }
    return false;
  }

  if (startNodes.length === 1) {
    const startId = startNodes[0].id;
    for (const [consumerId, consumer] of nodes) {
      // Extract variable references from prompt, toolCommand, label, and scriptArgs.
      // label is rendered by the wait-human handler (hexagon gates); scriptArgs
      // is rendered by the tool handler when script_file= is set. Both expand
      // $vars at runtime, so both must be scanned for path-wise availability.
      const fields = [
        consumer.prompt,
        consumer.toolCommand,
        consumer.label,
        consumer.scriptArgs,
      ].filter(Boolean) as string[];
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
        if (hasDefault(consumer, varName)) continue;

        // Find all producer nodes for this variable
        const producers = new Set<string>();
        for (const [nodeId, produced] of nodeProduces) {
          if (produced.has(varName)) producers.add(nodeId);
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
        if (reachableWithout(startId, consumerId, producers)) {
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
    }
  }

  // inputs_missing_frontmatter — auto_inputs: true requires explicit inputs: declaration
  // unknown_source_node — qualified inputs must reference existing graph nodes
  if (dotDir) {
    for (const node of nodes.values()) {
      if (!node.agent) continue;
      const cfg = tryResolveAgent(node, dotDir);
      if (!cfg) continue;
      if (cfg.autoInputs === true && cfg.inputs === undefined) {
        diags.push({
          rule: "inputs_missing_frontmatter",
          severity: "error",
          message: `Agent "${node.agent}" has auto_inputs: true but is missing required \`inputs:\` declaration. Use \`inputs: []\` if no inputs are needed.`,
          location: node.sourceLocation,
        });
      }
      // steering_has_var_token — auto_inputs steering must be pure prose (no $var tokens)
      if (cfg.autoInputs === true && node.prompt) {
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

      if (cfg.autoInputs === true && Array.isArray(cfg.inputs)) {
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
            // bare_input_not_in_caller_inputs_or_system — bare input must be either declared
            // in the digraph's inputs="..." attribute or be a system-injected var.
            if (!callerInputs.has(resolved.localKey) && !SYSTEM_VARS.has(resolved.localKey)) {
              diags.push({
                rule: "bare_input_not_in_caller_inputs_or_system",
                severity: "error",
                message: `Agent "${node.agent}" requires bare input "${resolved.localKey}" but it is neither declared in the digraph's inputs="..." nor a system-injected var. Add it to inputs="..." on the digraph or qualify it as "<source_node>.${resolved.localKey}".`,
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

  // resolveAgent needs projectDir to locate project-local agents; without dotDir we can't fetch agent configs.
  if (dotDir) {
    checkMissingInputProducer(graph, nodeProduces, dotDir, diags);
    checkInputTypeMismatch(graph, dotDir, diags);
    checkOrphanOutput(graph, dotDir, diags);
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

  for (const node of graph.nodes.values()) {
    if (!node.agent) continue;
    const cfg = tryResolveAgent(node, dotDir);
    if (!cfg?.inputs) continue;
    for (const k of cfg.inputs) consumed.add(k);
  }

  for (const edge of graph.edges) {
    if (!edge.condition) continue;
    const clauses = parseConditionClauses(String(edge.condition));
    for (const clause of clauses) consumed.add(clause.key);
  }

  const VAR_RE_LOCAL = /\$([a-zA-Z_][\w.]*)/g;
  for (const node of graph.nodes.values()) {
    const fields = [node.prompt, node.toolCommand, node.label, node.scriptArgs]
      .filter((f): f is string => typeof f === "string");
    for (const field of fields) {
      let m: RegExpExecArray | null;
      const re = new RegExp(VAR_RE_LOCAL.source, VAR_RE_LOCAL.flags);
      while ((m = re.exec(field)) !== null) {
        consumed.add(m[1].replace(/\.+$/, ""));
      }
    }
  }

  for (const [id, node] of graph.nodes) {
    if (!node.agent) continue;
    const cfg = tryResolveAgent(node, dotDir);
    if (!cfg?.outputs) continue;
    for (const key of Object.keys(cfg.outputs)) {
      if (consumed.has(key)) continue;
      diags.push({
        rule: "orphan_output",
        severity: "warning",
        message: `Agent "${node.agent}" at node "${id}" declares output "${key}" but no downstream node consumes it (no agent input, condition=, or $${key} reference). Drop "${key}" from outputs: or wire it into a consumer.`,
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
  if (!node.agent) return undefined;
  try {
    return resolveAgent(node.agent as string, { projectDir: dotDir, allowBundledFallback: false });
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

  // Candidate set: callerInputs declared on the digraph header
  const required = new Set<string>();
  for (const v of graph.inputs ?? []) {
    if (!RESERVED.has(v) && !internallyProduced.has(v)) required.add(v);
  }

  // Also include vars consumed via agent inputs: that are not produced internally
  if (dotDir) {
    for (const node of graph.nodes.values()) {
      if (!node.agent) continue;
      const cfg = tryResolveAgent(node, dotDir);
      if (!cfg?.inputs) continue;
      for (const k of cfg.inputs) {
        if (!RESERVED.has(k) && !internallyProduced.has(k)) required.add(k);
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

function checkMissingInputProducer(
  graph: Graph,
  nodeProduces: Map<string, Set<string>>,
  dotDir: string,
  diags: Diagnostic[],
): void {
  const RESERVED = new Set(["goal", "project", "run_id"]);
  const varsInScope = computeVarsInScope(graph, nodeProduces);
  const varsInAnyScope = computeVarsInAnyScope(graph, nodeProduces);
  for (const [id, node] of graph.nodes) {
    if (!node.agent) continue;
    const agentConfig = tryResolveAgent(node, dotDir);
    if (!agentConfig || !agentConfig.inputs) continue;
    const scope = varsInScope.get(id) ?? new Set<string>();
    const anyScope = varsInAnyScope.get(id) ?? new Set<string>();
    for (const inputKey of agentConfig.inputs) {
      if (RESERVED.has(inputKey)) continue;
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

  // When dotDir is undefined, resolveAgent skips project-local lookup and will
  // throw "Unknown agent" for any non-bundled agent. tryResolveAgent absorbs that
  // gracefully — the third test case relies on this path.
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
  if (node.interactive === true || node.interactive === "true") return;

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
  if (node.interactive === true || node.interactive === "true") return;

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
