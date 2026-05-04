## Build & Run

- Install: `npm install`
- Build: `npm run build` (tsup → dist/)
- Dev: `npm run dev` (tsx watch)
- Link for local testing: `npm link`

## Validation

- Tests: `npx vitest run`
- Typecheck: `npx tsc --noEmit`
- Smoke test: `npx vitest run src/cli/tests/smoke.test.ts` (requires `npm run build` first)

## Operational Notes

- Commands use `Agent` class from `src/cli/lib/agent.ts` to spawn Claude sessions
- Agent definitions are markdown files with YAML frontmatter, owned per-pipeline under `pipelines/<name>/<agent>.md`. There is no global registry — see `.ralph/docs/adr/0001-agents-live-next-to-pipeline.md`.
- Pipeline engine uses `AgentHandler` for all agent/codergen nodes — `loop.ts` and `CodergenHandler` have been removed
- All command output goes through `src/cli/lib/output.ts` — unified Ink output API (`step`, `info`, `warn`, `error`, `success`, `header`, `spinner`, `stream`)
- Prod/dev detection uses `__RALPH_PROD__` constant injected by tsup `define` at build time. Ambient type in `src/types/globals.d.ts`.

### Codebase Patterns

- CLI entry: `src/cli/index.ts` → commander setup
- Commands: `src/cli/commands/{implement,meditate,pipeline}.ts`
- Lib: `src/cli/lib/{agent,agent-loader,assets,frontmatter,output,stream-formatter}.ts`
- Tests: `src/cli/tests/*.test.ts` (vitest)
- Bundled folder pipelines: `src/cli/pipelines/{meditate,implement}/` (copied to `dist/pipelines/` by tsup)
- Daemon: `src/daemon/{state,scheduler,runner,socket,index}.ts`
- Shared lib: `src/lib/daemon-client.ts`
- Ink UI components: `src/cli/components/ui.tsx` (Step, Info, Warn, Error, Success, Header, StreamLine, StreamOutput, SpinnerLine)
- TUI components: `src/cli/components/HeartbeatWatch.tsx`

### Daemon

- Daemon socket: `~/.ralph/daemon.sock`, PID: `~/.ralph/daemon.pid`
- Task registry: `~/.ralph/tasks.json`, logs: `~/.ralph/logs/<task-id>/<run-id>.log`
- Dev mode daemon start: `tsx src/daemon/index.ts`
- Prod mode: `node dist/daemon/index.js`
- The CLI auto-starts the daemon when needed
