# `basename(__dirname)` Is a Fragile Contract

## Core Idea

The prod/dev detection logic throughout ralph-cli — `basename(__dirname) === "cli"`, `basename(__dirname) !== "dist"`, etc. — is implicitly coupled to the tsup bundling topology. Every time the topology changes (as it already has once, when multi-entry output replaced the flat `dist/` layout), these checks silently break. There are no tests that verify them under the actual compiled layout. The coupling is invisible until it fires.

## Why It Matters

The ESM migration just survived this fragility through careful human reasoning, not through tests. The IMPLEMENTATION_PLAN.md had to include an explicit correction note warning developers not to change `dir === "cli"` to `dir === "lib"` in `src/lib/daemon-client.ts` — because the spec made an incorrect assumption about where tsup bundles that file. That note lives in an untracked, ephemeral document. Once the migration is done and IMPLEMENTATION_PLAN.md is deleted or archived, the reasoning is gone.

Looking across the codebase, three separate files carry variants of this pattern:
- `src/cli/lib/assets.ts`: `basename(__dirname) === "cli" || basename(__dirname) === "dist"` — an accumulation of two checked values because the first one broke
- `src/lib/daemon-client.ts`: `dir === "cli"` — correct only because daemon-client bundles into dist/cli/index.js, a non-obvious property of which files tsup treats as entry points
- `src/cli/commands/meditate.ts`: `basename(__dirname) !== "cli" && basename(__dirname) !== "dist"` — a conjunction that was recently extended to handle the multi-entry layout

Each of these is a workaround piled on a previous workaround. The `the-agentic-loop-is-a-graph` lens applies here in reverse: when the "how do I know where I am" logic is a tangle of string comparisons without named phases or explicit conditions, the next topology change will produce the same silent failures.

## Revised Implementation Steps

1. **Add a build-time constant via tsup `define`.** In `tsup.config.ts`, add `define: { __RALPH_PROD__: "true" }`. In dev (`tsx`), this constant is undefined/false — tsx doesn't run tsup defines. Replace all `basename(__dirname)` checks with `typeof __RALPH_PROD__ !== "undefined"`. One boolean, one place of truth, no directory name sensitivity.

2. **Add a TypeScript ambient declaration** in `src/types/globals.d.ts`: `declare const __RALPH_PROD__: boolean | undefined;` so the compiler accepts the injected constant.

3. **Write a test that imports the compiled output and verifies prod detection.** In `src/cli/tests/assets.test.ts`, add a test that runs `node dist/cli/index.js --version` via `spawnSync` and checks exit code 0 — this smoke-tests that the production path resolution doesn't crash on startup. It's the minimum scenario test the `scenario-tests-catch-what-unit-tests-miss` lens demands.

4. **Remove the correction note from IMPLEMENTATION_PLAN.md** once the `define`-based approach is in place. The note only exists because the old approach was confusing. With `__RALPH_PROD__`, there's nothing to confuse.

5. **Update `tsup-multi-entry-path-issues.md`** in `memory/` to document that this pattern has been superseded. The memory file currently describes the problem; it should now describe the solution so future agents don't re-investigate.
