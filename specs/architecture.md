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
│   │   │   ├── frontmatter.ts          # Parses markdown frontmatter (YAML header + body)
│   │   │   ├── prompts.ts              # bootstrap logic
│   │   │   ├── assets.ts               # asset path resolution (dev vs prod)
│   │   │   ├── output.ts               # unified Ink output API
│   │   │   └── stream-formatter.ts     # stream-json → human-readable output
│   │   ├── mcp/
│   │   │   └── illumination-server.ts  # MCP server for meditate write access
│   │   ├── agents/                     # bundled agent definition files
│   │   │   ├── implement.md
│   │   │   ├── plan.md
│   │   │   ├── meditate.md
│   │   │   ├── meditate-create.md
│   │   │   └── agent-creator.md
│   │   └── prompts/
│   │       ├── PROMPT_plan.md          # bundled default
│   │       └── PROMPT_build.md         # bundled default
│   ├── daemon/
│   │   ├── index.ts                    # daemon entry point
│   │   ├── runner.ts                   # child process runner
│   │   ├── scheduler.ts                # task scheduling logic
│   │   ├── socket.ts                   # Unix socket IPC server
│   │   └── state.ts                    # persistent state management
│   └── lib/
│       └── daemon-client.ts            # socket client (auto-starts daemon)
├── tsup.config.ts                      # builds src/ → dist/, copies assets
└── dist/                               # published artifact (not committed)
```

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
