# Chunk 1 Plan Review — Pipeline Folder Architecture Redesign

**Plan:** `docs/superpowers/plans/2026-04-27-pipeline-folder-architecture-redesign.md`
**Spec:** `docs/superpowers/specs/2026-04-27-pipeline-folder-architecture-redesign.md`
**Reviewer date:** 2026-04-27
**Verdict:** Issues Found — needs revisions before execution

## What's strong

- TDD cycle (write-fail-implement-pass-commit) is consistent across Tasks 1.2–1.5.
- Task 1.6 ends with a real-pipeline migration — strong proof step.
- File Structure table at top accurately scopes Chunk 1 areas.
- Conflict diagnostic builds on the existing `script_command_conflict` precedent (good consistency).
- Commit messages follow conventional-commits and lean on "what changed" with implicit "why" — acceptable.

## Critical issues (must fix before execution)

### C1. Frontmatter parser uses `gray-matter`, not `yaml` (plan and assumptions wrong)
`src/cli/lib/frontmatter.ts:1` imports `matter from "gray-matter"`. Plan repeatedly states the `yaml` package handles parsing (lines 9, 122, 340 of spec R5). gray-matter does delegate to `js-yaml` by default which DOES support flow-style mappings, so the test in Task 1.1 should still pass — but the plan's reasoning is incorrect, and Task 1.1 Step 1 instructs `cat src/cli/lib/frontmatter.ts` expecting to see `YAML.parse(...)` which the reader will not find. **Fix:** rewrite Step 1's expected output to match the actual `gray-matter` import; confirm js-yaml supports the flow-style fragments (it does); add one explicit test that round-trips `{enum: [a, b]}` and `{type: string, maxLength: 100}` to lock that contract.

### C2. `validateAgentConfig` shape mismatch
Plan's Task 1.2 Step 4 shows extending an interface with `outputs?` and adds it inside `validateAgentConfig`. Actual `src/cli/lib/agent.ts:420-437` returns a literal-property object; if you don't add `outputs`/`outputsSchema` to that returned literal, they get dropped. The plan's snippet says "attach `outputs` and `outputsSchema`" without showing the literal-object edit at lines 428-436. **Fix:** add the exact diff for the return statement, e.g. `...(parsed.outputs ? { outputs: parsed.outputs, outputsSchema: deriveOutputsSchema(parsed.outputs) } : {})`.

### C3. Task 1.3 test uses non-existent `outputsSchema`/`jsonSchema` field on AgentConfig
`AgentConfig` exposes `jsonSchema?: string` (line 24, a JSON-string), not a `JsonSchema` object. The handler passes `jsonSchema` as a *string* (line 99-101 builds it via template literal). Task 1.3's test asserts `seen.schema` equals an object schema — mismatched contract. **Fix:** the plan must decide whether `outputsSchema` lives separately on `AgentConfig` (preferred — keeps legacy `jsonSchema` string path intact) or whether the handler stringifies `outputsSchema` into `config.jsonSchema` before constructing `Agent`. Spell this out as Step 0 of Task 1.3.

### C4. Task 1.4 uses `outcome.contextWiden` which does not exist
The handler returns `contextUpdates`, not `contextWiden` (`src/attractor/types.ts:16`, `agent-handler.ts:152, 167, 300`). Test will fail with the wrong assertion shape and confuse the implementer. **Fix:** rename to `outcome.contextUpdates` in the test body.

### C5. Task 1.4 derivation is wrong with current code path
Today the agent-handler does NOT use `node.produces` to build `contextUpdates` for structured output — it iterates `Object.entries(parsed)` from the JSON response (line 279-281). `produces=` is consumed by `variable-expansion.ts:163-165` and the validator (`graph.ts:180`). So there is nothing to "derive" inside agent-handler.ts; the missing piece is making **the validator and variable-expansion** see `outputs:` keys as produced. **Fix:** Task 1.4 should target `src/attractor/core/graph.ts:164-181` (collectProducedVars) and `variable-expansion.ts:163-165`, not agent-handler.ts. The test should assert that downstream `$preferred_label` resolves without `produces=` on the node.

## Important issues (should fix)

### I1. Task 1.3 missing both-set edge case
Reviewer prompt asked: what if BOTH `outputsSchema` and `jsonSchemaFile` are present at handler runtime? Plan picks `outputsSchema` silently. The validator (Task 1.5) catches it as an error, but the handler runs even when validate is skipped (`pipeline run` does not require prior validate). **Fix:** add a Task 1.3 sub-test asserting handler returns `status: "fail"` with `outputs_and_schema_file_conflict` when both present, mirroring validator semantics.

### I2. Task 1.2 missing zero-keys edge case
Reviewer prompt asked: degenerate case `outputs: {}`. Plan does not test it. `deriveOutputsSchema` with empty object yields `required: []` which is technically valid JSON Schema but semantically pointless. **Fix:** add a test that empty `outputs:` either throws (preferred — catches author typos) or normalizes to `outputs: undefined`. Document chosen behavior.

### I3. Task 1.5 missing `dotDir === undefined` case
`checkAgentOutputsConflict` early-returns on missing file but assumes `dotDir` is a string. `validateGraph` is called from contexts without filesystem (e.g. `dual-parser.test.ts:62`). **Fix:** guard `if (!dotDir) return;` at top of helper and add a unit test asserting the validator does not crash when `dotDir` is undefined.

### I4. Task 1.6 lacks live-run verification
Step 6 says "if no smoke directly exercises the verifier, run `npm run test`." Reviewer prompt explicitly asked for live-run verification. The verifier is exercised by `illumination-to-implementation.dot`; a partial live run (with `--max-iterations 1` or a stubbed input illumination) would prove end-to-end. **Fix:** add explicit step: `node dist/cli/index.js pipeline run pipelines/illumination-to-implementation/pipeline.dot --project /tmp/scratch-$(date +%s)` (after Chunk 4 path) or a dedicated smoke pipeline that wraps the verifier. If a true live run is too heavy, at minimum dispatch `pipeline trace` against a recent run dir to confirm `outputs:` keys land in context.

### I5. Step 2 of Task 1.5 schema-on-disk path is hand-wavy
`resolvePath(dotDir, '${node.agent}.md')` assumes the agent file sits next to the `.dot`. Today it doesn't — `verifier.md` is in `src/cli/agents/`. **Fix:** call `resolveAgent(node.agent, opts)` from `agent-registry.ts` (already supports this lookup) instead of manually resolving paths. Otherwise the validator silently skips the conflict for every project pipeline that uses bundled agents.

### I6. Test labels too generic in Task 1.3
"uses agent's outputsSchema when jsonSchemaFile is unset" describes implementation, not behavior. **Fix:** "agent without json_schema_file constrains output to outputs: shape" — names what observable behavior is asserted.

## Suggestions (nice to have)

- **S1.** Task 1.6 Step 2 shows `outputs:` insertion location ("between `mcp:` block and closing `---`"). Show the exact 3-4 line diff inline in plan; otherwise the implementer copy-pastes and locations drift.
- **S2.** Task 1.5 emits warning for `produces_redundant_with_outputs`. Once Task 1.4 derives produces from outputs, the engine no longer needs `produces=` on the node — consider escalating to error in a follow-up release; track in plan as an "after-Chunk-1 cleanup" note.
- **S3.** Spec D2 says "if `outputs:` is set, `produces=` on the `.dot` is ignored (and a warning emitted)." Plan implements this only when keys match exactly (Task 1.5 Step 3 sameSet check). What if `produces=` lists a subset? Plan should clarify: ignore + warn vs. error.
- **S4.** Add a Task 1.0 (pre-flight): `git rm` `src/cli/agents/verifier.md` legacy schema reference once after migration, OR document that `verifier.md` keeps its own schema file as deprecated path until Chunk 4. Currently ambiguous.

## Chunk 2-6 outline coherence

- **Chunk 2 outline:** coherent. `inputs:` + flow validator naturally builds on Chunk 1's frontmatter parser. Task list is plausible.
- **Chunk 3:** coherent. Gate `.md` discriminator via `type: gate` mirrors agent shape — good symmetry.
- **Chunk 4:** outline notes "largest blast radius" and proposes per-pipeline-per-commit. Solid risk framing. Missing: explicit note that `pipelines/smoke/` stays as-is (D4 mentions but Chunk 4 outline does not restate).
- **Chunk 5:** coherent. Templates infra mirrors agents infra.
- **Chunk 6:** coherent. Six commands collapse to thin shims — clear pattern.

## Recommended action

1. Fix C1–C5 before any subagent picks up Chunk 1 (these will cause TDD failures that mislead the implementer rather than confirming missing functionality).
2. Address I1–I6 in same revision pass.
3. Treat S1–S4 as opt-in.
4. Re-issue Chunk 1 plan; then proceed to subagent-driven execution.
