# Architecture

## Package

| Field | Value |
|---|---|
| npm name | `ralph-cli` |
| binary | `ralph` |
| runtime | Node.js >=18 |
| module type | ESM (`"type": "module"`) |
| build | tsup (ESM output) |
| arg parsing | commander |

## File Structure

```
ralph-cli/
├── src/
│   ├── cli/
│   │   ├── index.ts                    # CLI entry point
│   │   ├── program.ts                  # commander registration for all commands
│   │   ├── commands/
│   │   │   ├── plan.ts                 # ralph plan
│   │   │   ├── implement.ts            # ralph implement
│   │   │   ├── new.ts                  # ralph new
│   │   │   ├── meditate.ts             # ralph meditate
│   │   │   ├── meditate-create.ts      # ralph meditate create
│   │   │   ├── agent.ts                # ralph agent (list, show, create)
│   │   │   ├── pipeline.ts             # ralph pipeline (run, list, create)
│   │   │   └── heartbeat.ts            # ralph heartbeat (subcommands)
│   │   ├── lib/
│   │   │   ├── agent.ts                # Agent class — config to claude spawn, stream, result
│   │   │   ├── agent-registry.ts       # Resolves agent names to AgentConfig from ~/.ralph/agents/
│   │   │   ├── assets.ts               # asset path resolution (dev vs prod)
│   │   │   ├── classifyNode.ts         # DOT node → handler type classification
│   │   │   ├── claudeTracePath.ts      # Claude session trace path resolution
│   │   │   ├── frontmatter.ts          # Parses markdown frontmatter (YAML header + body)
│   │   │   ├── output.ts               # unified Ink output API
│   │   │   ├── parse-structured-output.ts # Extracts structured data from Claude output
│   │   │   ├── parseClaudeEvent.ts     # stream-json event parser
│   │   │   ├── pipeline-resolver.ts    # Resolves DOT file → pipeline config
│   │   │   ├── pipelineEvents.ts       # Pipeline event types and emitter
│   │   │   ├── pipelineReducer.ts      # Pipeline state reducer for TUI
│   │   │   ├── session.ts              # Claude session management
│   │   │   ├── slash-commands.ts        # Slash command parsing
│   │   │   ├── stream-formatter.ts     # stream-json → human-readable output
│   │   │   └── stream-json-input.ts    # JSON stream line parser
│   │   ├── components/                  # Ink (React) TUI components
│   │   │   ├── ui.tsx                  # Base UI primitives (Step, Info, Warn, Error, Success, Header, StreamLine, StreamOutput, SpinnerLine)
│   │   │   ├── BlockView.tsx           # Pipeline node block display
│   │   │   ├── GateSelector.tsx        # Interactive gate/branch selector
│   │   │   ├── HeartbeatWatch.tsx      # Real-time heartbeat dashboard
│   │   │   ├── LiveFooter.tsx          # Pipeline live status footer
│   │   │   ├── PipelineApp.tsx         # Pipeline TUI root component
│   │   │   └── TextInput.tsx           # Text input component
│   │   ├── mcp/
│   │   │   └── illumination-server.ts  # MCP server for meditate write access (10 tools)
│   │   ├── agents/                     # bundled agent definition files (fallback for project-local agents)
│   │   │   ├── implement.md
│   │   │   ├── meditate.md
│   │   │   ├── chat.md
│   │   │   └── ...
│   │   └── templates/                   # bundled pipeline templates (one folder per command)
│   ├── attractor/                       # Pipeline execution engine
│   │   ├── types.ts                    # Pipeline type definitions
│   │   ├── checkpoint.ts              # Pipeline checkpoint/resume support
│   │   ├── core/
│   │   │   ├── engine.ts              # Pipeline execution engine (node traversal, event emission)
│   │   │   ├── graph.ts               # DOT graph parser → directed graph
│   │   │   └── conditions.ts          # Edge condition evaluation
│   │   ├── handlers/                   # Node type handlers
│   │   │   ├── registry.ts            # Handler registry (maps node types to handlers)
│   │   │   ├── agent-handler.ts       # Agent/codergen node handler (spawns Claude)
│   │   │   ├── conditional.ts         # Conditional branching handler
│   │   │   ├── manager-loop.ts        # Manager loop iteration handler
│   │   │   ├── parallel.ts            # Parallel node execution handler
│   │   │   ├── ralph-meditate.ts      # Ralph meditate integration handler
│   │   │   ├── start-exit.ts          # Start/exit node handlers
│   │   │   ├── store.ts              # Store node handler (state persistence)
│   │   │   ├── tool.ts               # Generic tool handler
│   │   │   └── wait-human.ts         # Human interaction wait handler
│   │   ├── interviewer/               # Interactive input subsystem
│   │   │   ├── index.ts              # Interviewer factory
│   │   │   ├── ink.ts                # Ink-based interactive interviewer
│   │   │   ├── console.ts            # Console-based interviewer (non-TUI)
│   │   │   ├── auto-approve.ts       # Auto-approve interviewer (non-interactive)
│   │   │   ├── callback.ts           # Callback-based interviewer
│   │   │   └── queue.ts             # Question queue management
│   │   └── transforms/               # Pipeline data transforms
│   │       ├── preamble.ts           # Preamble text injection
│   │       └── variable-expansion.ts # Template variable expansion
│   ├── daemon/
│   │   ├── index.ts                    # daemon entry point
│   │   ├── runner.ts                   # child process runner
│   │   ├── scheduler.ts                # task scheduling logic
│   │   ├── socket.ts                   # Unix socket IPC server
│   │   └── state.ts                    # persistent state management
│   ├── lib/
│   │   └── daemon-client.ts            # socket client (auto-starts daemon)
│   └── types/
│       └── globals.d.ts                # ambient __RALPH_PROD__ type declaration
├── tsup.config.ts                      # builds src/ → dist/, copies assets
└── dist/                               # published artifact (not committed)
```

Tool nodes (handled by `attractor/handlers/tool.ts`) may externalise their logic to a script on disk via the `script_file=` DOT attribute (resolved relative to the pipeline file, conventionally under `pipelines/scripts/`) — see [`docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md`](../docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md).

`attractor/handlers/parallel.ts` exports two handlers: `ParallelHandler` executes a fan-out node, gathering per-branch outcomes from `meta.branchOutcomes` and serialising them into the `parallel.results` context key; `FanInHandler` (registered as `parallel.fan_in`) reads that key back, parses the per-branch outcomes, and rolls them up into a single `success` / `partial_success` / `fail` status depending on whether all, some, or none of the branches succeeded.

Agent nodes resolve their agent name against the **pipeline directory** first: `attractor/handlers/agent-handler.ts` calls `resolveAgent(name, { projectDir: meta.dotDir, allowBundledFallback: false })`, so for a pipeline at `pipelines/<name>/pipeline.dot` the handler reads `pipelines/<name>/<agent>.md`. If the file is absent, the user-level `~/.ralph/agents/` registry is consulted; missing in both, the run fails. There is no bundled-agents fallback for pipeline runtime — every pipeline owns its agents.

## Build Entry Points

tsup compiles 4 entries:

| Source | Output | Purpose |
|--------|--------|---------|
| `src/cli/index.ts` | `dist/cli/index.js` | `ralph` binary |
| `src/cli/mcp/illumination-server.ts` | `dist/cli/mcp/illumination-server.js` | MCP server binary |
| `src/cli/lib/stream-formatter.ts` | `dist/cli/lib/stream-formatter.js` | standalone pipe filter |
| `src/daemon/index.ts` | `dist/daemon/index.js` | background daemon |

## Asset Bundling

`tsup.config.ts` copies bundled pipeline templates from `src/cli/templates/` and pipeline `.dot` files from `src/cli/pipelines/` into `dist/` via an `onSuccess` hook. The `meditations/` directory at the repo root is not rewritten into `dist/` — it is published directly by npm via the `files` entry in `package.json`, so installed copies of the package carry `meditations/` next to `dist/`. At runtime, `assets.ts` resolves paths relative to the compiled entry point using a prod/dev detection constant (`__RALPH_PROD__`) injected by tsup's `define` config.

## Bundled Template Resolution

Commands that represent complete workflows (`plan`, `meditate`, `meditate-create`, `new`, `pipeline refine`, `pipeline create`) are thin shims that delegate to a bundled pipeline template rather than spawning Claude directly.

The resolution flow is:

1. Command shim calls `resolveBundledTemplate(name)` (in `src/cli/lib/assets.ts`).
2. `resolveBundledTemplate` returns the absolute path to `dist/templates/<name>/pipeline.dot` (dev: `src/cli/templates/<name>/pipeline.dot`).
3. The shim calls `pipelineRunCommand(dotFile, opts)`, passing the resolved dot path and any command-specific options (e.g. `project`, `variables`).
4. The pipeline runtime executes the template; its agent nodes are resolved via the standard per-folder + bundled-fallback chain (see the Agent resolution section below).

Template names map directly to directories under `src/cli/templates/`:

| Command | Template name | Template path |
|---------|--------------|---------------|
| `ralph plan` | `plan` | `templates/plan/pipeline.dot` |
| `ralph meditate` | `meditate` | `templates/meditate/pipeline.dot` |
| `ralph meditate create` | `meditate-create` | `templates/meditate-create/pipeline.dot` |
| `ralph new` | `new` | `templates/new/pipeline.dot` |
| `ralph pipeline refine` | `pipeline-refine` | `templates/pipeline-refine/pipeline.dot` |
| `ralph pipeline create` | `pipeline-create` | `templates/pipeline-create/pipeline.dot` |

There are no `PROMPT_*.md` files under `src/cli/prompts/` — that folder was removed when commands migrated to the template architecture.

## Checkpoint and Resume

`src/attractor/checkpoint.ts` persists a `CheckpointState` JSON blob (`{ timestamp, currentNode, completedNodes, nodeRetries, context }`) to `<logsRoot>/checkpoint.json`, which defaults to `~/.ralph/<projectKey>/runs/<runId>/checkpoint.json`. The trace and checkpoint share that directory: `pipeline.jsonl` and `checkpoint.json` sit side by side. `core/engine.ts` writes the checkpoint at each node advance — before a node executes, after a successful transition, after taking a fail edge, and on retry — so that a run interrupted by Ctrl-C or a failing node can be resumed from the last completed boundary.

`ralph pipeline run <dot-file> --resume` calls `loadCheckpoint()` and replays from the recorded `currentNode`, preserving `completedNodes`, `nodeRetries`, and accumulated `context.values`. A fresh run gets a new `<runId>` directory; older runs are pruned lazily (last 50 per project, override with `RALPH_RUNS_KEEP`). Scripts invoked from tool nodes should still be idempotent because `--resume` may re-execute the node that failed within a single run.
