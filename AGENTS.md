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
- Commands: `src/cli/commands/{plan,implement,new}.ts`
- Lib: `src/cli/lib/{assets,prompts}.ts`
- Tests: `src/cli/tests/*.test.ts` (vitest)
- Bundled prompts: `src/cli/prompts/PROMPT_{plan,build,kickoff}.md`
