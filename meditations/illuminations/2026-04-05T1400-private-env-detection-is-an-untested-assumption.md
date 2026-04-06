# Private Environment-Detection Functions Are Untested Assumptions

## Core Idea

`isDevMode()` in `meditate.ts` was returning `true` in production for its entire existence — meaning meditate always launched with `tsx` instead of `node`, which would fail silently on machines without tsx installed. No test caught this because tests run in dev context, where the wrong return value was accidentally correct. Private functions that branch on environment are a systematic blind spot: they compile, pass all tests, and ship wrong.

## Why It Matters

The bug was fixed during the ESM migration path audit (`meditate.ts:54-55`), not by a failing test. The same audit found `runner.ts` pointing to `dist/index.js` instead of the correct `dist/cli/index.js`. Both bugs were pre-existing, neither was discovered by the test suite, both were found by code inspection triggered by an unrelated structural change.

`meditate.test.ts` tests `writeMcpConfig` carefully — it checks the config file path, the projectRoot argument, the meditationsDir argument — but never asserts `command === "node"`. The most important production behavior of that function is the one thing the tests don't cover. `isDevMode()` itself is private and unexported, with no direct test surface. There is no way to call it from a test that simulates a production `__dirname`.

This pattern recurs: `daemon-client.ts` has path logic conditioned on `basename(__dirname) === "cli"`, `runner.ts` had a hardcoded path assumption about dist layout. All three are environment-detection branches in non-exported code. All three required a human audit to verify. None would produce a test failure if they were wrong.

The `scenario-tests-catch-what-unit-tests-miss` lens is precise here: the scenario that exposes these bugs is `npm install -g ralph-cli && ralph meditate ./some-project` on a machine without tsx. That scenario has never been automated. The unit tests can't simulate it because they run via vitest in the same dev process where `__dirname` has none of the production layout properties.

## Revised Implementation Steps

1. **Export `isDevMode` from `meditate.ts`.** Make it a named export so tests can call it directly. It takes no arguments — its result depends on `__dirname` — so it needs either a parameter injection pattern or a test that inspects `writeMcpConfig` output.

2. **Add a test to `meditate.test.ts` asserting production command selection.** The test for `writeMcpConfig` should assert `config.mcpServers.illumination.command === "node"` when running from a built context, or structure `isDevMode` to accept an optional `dir` override for testing: `isDevMode(dir = __dirname)`.

3. **Add a test to `runner.test.ts` for `getRalphCliPath()`.** Confirm the returned path ends in `cli/index.js`, not `index.js`. This would have caught the pre-existing wrong path before the ESM audit found it.

4. **Establish a convention in `AGENTS.md` or `specs/architecture.md`:** any function that branches on `__dirname`, `basename`, or environment variables must be exported and have explicit tests for each branch. Private environment detection is where assumptions go to die quietly.

5. **Add a smoke-test script** (`scripts/smoke-test.sh` or similar) that installs from a local tarball (`npm pack && npm install -g ./ralph-cli-*.tgz`) and runs `ralph meditate ./test-fixture`. This is the scenario that catches everything the unit tests cannot — wrong paths, wrong runtime selection, missing assets — and it has never existed.
