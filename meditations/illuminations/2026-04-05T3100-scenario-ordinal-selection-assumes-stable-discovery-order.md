# Scenario Ordinal Selection Assumes Stable Discovery Order

## Core Idea

`discoverScenarios` calls `readdirSync` without sorting the result. The interactive selection UI assigns ordinal numbers (1, 2, 3...) to files in that filesystem-order. Adding, renaming, or removing any file in `scenario-tests/` silently shifts all subsequent ordinals. A user who has internalized "run 1 and 3" or a CI script that pipes `echo "1 3"` into `ralph run-scenarios` will select different scenarios after the folder changes — with no warning, no error, and no indication that the mapping has shifted.

## Why It Matters

The unit tests for `discoverScenarios` in `docs/superpowers/plans/2026-04-05-run-scenarios.md` (Task 6) only ever test one file at a time. The single-file tests pass regardless of sort order. The multi-file case — the only case where ordering matters — is never exercised. This means the gap cannot be detected by running the test suite; it only surfaces in use.

The `idempotency` lens makes the requirement explicit: running `ralph run-scenarios .` twice with the same `scenario-tests/` contents should present the same list in the same order. On APFS and ext4, `readdirSync` typically returns creation order, which is stable within an unchanged directory but will shift when files are added anywhere in the directory (not just at the end). The behavior is filesystem-dependent, not guaranteed, and not tested.

The selection model compounds the risk. Unlike test frameworks that select by name (`vitest run -t "Auth Test"`) or by path, the `ralph run-scenarios` prompt accepts ordinals: `1 3`. Ordinals are convenient for a human at a keyboard; they are fragile in any context where the list might have changed since the user last looked. The spec's own example — `"Enter numbers to run (e.g. 1 3) or 'all'"` — normalizes ordinal use without noting the precondition that the list must be stable.

The mismatch between `discoverScenarios`'s sort contract (none) and the UI's implied contract (stable ordinals) is a one-line fix in the implementation but a real failure mode in regular use: the project grows new scenario files, the numbers shift, and the user runs the wrong scenarios until they notice the output doesn't match what they expected.

## Revised Implementation Steps

1. **Sort `readdirSync` output alphabetically in `discoverScenarios`.** One line change inside the `.map()` chain:
   ```typescript
   return readdirSync(scenarioDir, { withFileTypes: true })
     .filter((entry) => entry.isFile())
     .sort((a, b) => a.name.localeCompare(b.name))  // ← add this
     .map((entry) => { ... });
   ```
   Alphabetical sort by filename is deterministic, filesystem-agnostic, and matches user intuition (files added later appear at their alphabetical position, not at the end).

2. **Add a multi-file ordering test to `run-scenarios.test.ts`.** Create two files with names that would be out of order by creation time but in order alphabetically (`test-beta.sh`, `test-alpha.sh` — write beta first, alpha second). Assert that `discoverScenarios` returns alpha before beta. This test will fail on the unsorted implementation and pass after the fix, making the contract explicit.

3. **Add a stability note to the selection prompt.** Change the prompt from `"Enter numbers to run (e.g. 1 3) or 'all':"` to `"Enter numbers to run (e.g. 1 3) or 'all' (files sorted alphabetically):"`. One phrase. Users who script against ralph can rely on alphabetical order; users at the keyboard see that the list is deterministic.

4. **Consider `--scenario <name>` as a future flag for name-based selection.** Ordinal selection is appropriate for interactive use but not for CI pipelines or documented runbooks. A `--scenario "Auth Flow Integration"` flag that matches against the parsed `@name:` field would let scripts name what they mean. This is a follow-on feature, not required for v1 — but the sort change in step 1 is its prerequisite: name-based selection only makes sense when the displayed names come from a stable, searchable source.
