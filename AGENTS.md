## Build & Run

- Install: `npm install`
- Build: `npm run build` (tsup → dist/)
- Dev: `npm run dev` (tsx watch)
- Link for local testing: `npm link`

## Validation

- Tests: `npx vitest run`
- Typecheck: `npx tsc --noEmit`

## Operational Notes

- `loop.sh` requires explicit prompt file path as first arg: `./loop.sh <prompt-file-path> [max_iterations]`
- Asset path resolution in `src/cli/lib/assets.ts` detects dist vs dev via `basename(__dirname)` — in dist it uses `__dirname` directly, in dev it goes up one level to `src/cli/`

### Codebase Patterns

- CLI entry: `src/cli/index.ts` → commander setup
- Commands: `src/cli/commands/{plan,implement,new,meditate,meditate-create}.ts`
- Lib: `src/cli/lib/{assets,prompts}.ts`
- Tests: `src/cli/tests/*.test.ts` (vitest)
- Bundled prompts: `src/cli/prompts/PROMPT_{plan,build,kickoff}.md`
- Daemon: `src/daemon/{state,scheduler,runner,socket,index}.ts`
- Shared lib: `src/lib/daemon-client.ts`
- TUI components: `src/cli/components/HeartbeatWatch.tsx`

### Daemon

- Daemon socket: `~/.ralph/daemon.sock`, PID: `~/.ralph/daemon.pid`
- Task registry: `~/.ralph/tasks.json`, logs: `~/.ralph/logs/<task-id>/<run-id>.log`
- Dev mode daemon start: `tsx src/daemon/index.ts`
- Prod mode: `node dist/daemon/index.js`
- The CLI auto-starts the daemon when needed
