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
│   │   │   ├── run-scenarios.ts        # ralph run-scenarios
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
│   │   │   ├── prompts.ts              # bootstrap logic
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
│   │   ├── agents/                     # bundled agent definition files
│   │   │   ├── implement.md
│   │   │   ├── plan.md
│   │   │   ├── meditate.md
│   │   │   ├── meditate-create.md
│   │   │   ├── chat.md
│   │   │   └── agent-creator.md
│   │   └── prompts/
│   │       ├── PROMPT_plan.md          # bundled default
│   │       └── PROMPT_build.md         # bundled default
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
│   │   │   ├── ralph-scenarios.ts     # Ralph scenarios integration handler
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

## Build Entry Points

tsup compiles 4 entries:

| Source | Output | Purpose |
|--------|--------|---------|
| `src/cli/index.ts` | `dist/cli/index.js` | `ralph` binary |
| `src/cli/mcp/illumination-server.ts` | `dist/cli/mcp/illumination-server.js` | MCP server binary |
| `src/cli/lib/stream-formatter.ts` | `dist/cli/lib/stream-formatter.js` | standalone pipe filter |
| `src/daemon/index.ts` | `dist/daemon/index.js` | background daemon |

## Asset Bundling

`tsup.config.ts` copies bundled prompt files from `src/cli/prompts/` and agent definitions from `src/cli/agents/` into `dist/` via an `onSuccess` hook. At runtime, `assets.ts` resolves paths relative to the compiled entry point using a prod/dev detection constant (`__RALPH_PROD__`) injected by tsup's `define` config.
