# Chat notes — 93e68c2e-54f8-414e-85d8-11412384be39

Illumination: `meditations/illuminations/2026-04-20T2600-pipeline-smoke-harness-first-class.md`

## Round 1 — Simple explanation requested

### User question
"Explain this me in very simple terms and output examples if the change would be approved"

### Plain-language summary

- `pipelines/smoke/` already holds 14 fake test pipelines, but convention is invisible: no spec, no lint rule, no mock mechanism, no scaffolding hook.
- Only 1/5 production pipelines has a smoke twin. Regressions in `illumination-to-plan`, `illumination-to-implementation`, `gate-test`, `structured-output-test` ship silently.
- Proposal makes smoke harness first-class: spec + `--mock` runtime flag + lint warning + scaffold hooks + CI loop + per-branch mocks.

### Concrete shape if approved

**Naming convention**
```
pipelines/
  illumination-to-plan.dot
  smoke/
    illumination-to-plan.smoke.dot
    illumination-to-plan/
      verifier.mock.json
      explainer.mock.json
```

**Mock JSON** (`verifier.mock.json`)
```json
{
  "explanation": "fake verifier text",
  "verdict": "proceed"
}
```

**New CLI flag**
```bash
ralph pipeline run pipelines/smoke/illumination-to-plan.smoke.dot \
  --mock pipelines/smoke/illumination-to-plan/
```
Runner intercepts agent dispatch → loads `<node-id>.mock.json` → skips real Claude call. Tool/gate/store/conditional nodes still execute.

**Lint-lane warning** (non-fatal)
```
[lint] pipelines/gate-test.dot has no smoke twin at pipelines/smoke/gate-test.smoke.dot
```

**Per-branch mocks** for conditional edges
```
pipelines/smoke/approval-flow/
  archive.mock.json
  dispatch.mock.json
  decline.mock.json
```
CI iterates every mock, asserts each reaches `exit` event.

**Scaffold auto-fill**
- `ralph pipeline create my-flow` emits both real `.dot` and smoke twin pre-wired to `--mock`.
- `ralph pipeline scaffold-agent` emits default `<node-id>.mock.json` with empty-string values for every declared `produces` field.

**CI integration** — `npm test` iterates `pipelines/smoke/*.smoke.dot` with sibling mocks, asserts zero `[syntax]`/`[validate]` diagnostics and terminal `exit` event in `~/.ralph/runs/<run-id>/`.

### Bug classes the harness catches (static validation cannot)

1. **Agent output schema drift** — rubric's natural-language instructions permit skipping a `produces` field; zod can't read English. Mock with omitted field exposes downstream `$var` interpolation as undefined.
2. **Conditional edge dead ends** — label typos (`--Archive-->` vs `--archive-->`) only fire when a specific branch is taken. Per-branch mocks enumerate them.
3. **Tool-node script regressions** — `script_file` throws on valid input passes schema validation, fails on first real run (the exact class `mark-archived` missed).

### Affected surface area

- **New:** `specs/pipeline-smoke-tests.md`
- **New scaffolded:** smoke twins for `gate-test`, `structured-output-test`, `illumination-to-plan`, `illumination-to-implementation` + per-branch `*.mock.json`
- **Modified:** `src/cli/program.ts` (register `--mock <dir>`), attractor runner (intercept agent dispatch), lint-lane module (T2400), `ralph pipeline create` / `scaffold-agent` command modules, `package.json` / CI test script
- **Reference only:** existing 14 `pipelines/smoke/*.dot` — migrate to `.smoke.dot` or grandfather

### Pairs with

- `2026-04-20T1900-path-sensitive-var-flow-validator.md` (static defense)
- `2026-04-20T2400-split-validate-and-lint-lanes.md` (lint severity home)
- `2026-04-20T2100-agent-scaffold-command.md` (scaffold hook)
- `2026-04-20T2200-explicit-consumes-declarations.md` (mock auto-fill from declared produces)

Static + runtime defenses — neither sufficient alone.

### Conclusions so far

- User has not yet endorsed/declined. Round 1 was explanation only.
- No open objections. No requested scope changes.

## Round 2 — User flags feature creep + mocking objection

### User position
"Sounds complicated. Is there possibility of feature creep? What problem this change would solve? In my opinion smoke pipelines should not to be mocked in order to let tmux tester to catch actual errors after implementations."

### Feature-creep surface (confirmed legitimate)

Proposal stacks **3 net-new mechanisms** + **3 touchpoints** + CI wiring:
- `--mock <dir>` runtime flag + agent-dispatch interception in attractor runner
- `<node-id>.mock.json` fixture convention per agent node
- Per-branch mock directories (fixture sprawl grows with conditional edges)
- `specs/pipeline-smoke-tests.md`
- Lint-lane missing-twin warning (depends on T2400 landing)
- Scaffold emitters in `ralph pipeline create` + `scaffold-agent` (depends on T2100)
- CI loop in `npm test`
- **Implicit dependencies on 4 open illuminations**: T1900 (path-sensitive validator), T2100 (scaffold-agent), T2200 (explicit consumes), T2400 (split lint lanes).

### User's mocking objection — load-bearing

Current smoke pipelines run **real agents end-to-end**. They are the tmux-tester regression net for agent rubric drift, prompt regressions, JSON-schema mismatch, and output shape changes.

Mock substitution catches only *structural* drift (zod schema match). It does **not** catch *semantic* drift — a rubric that quietly starts omitting a field, a prompt that changes verdict wording, a model behavior change. Those are the bugs tmux-tester exists to catch. Mocking the smoke layer strips that signal.

Illumination's mock rationale ("cost/speed in CI" + "deterministic branch selection") is weak because:
- tmux-tester already budgets real runs.
- Conditional branches can be steered via authored prompts in smoke twins — no mock fixtures needed.
- Fixture sprawl itself becomes a maintenance cost: every rubric change requires fixture update.

### Narrower scope — recommended

**Drop from illumination:**
- `--mock <dir>` flag and dispatch interception
- `<node-id>.mock.json` convention
- Per-branch mock directories
- Scaffold mock emitter
- Dependencies on T2100 / T2200

**Keep from illumination:**
- `specs/pipeline-smoke-tests.md` — naming (`<name>.smoke.dot`), location, "must reach `exit`"
- Backfill 4 missing smoke twins (`gate-test`, `structured-output-test`, `illumination-to-plan`, `illumination-to-implementation`) — real agents, narrow prompts
- Lint-lane warning for missing twin (optional piggyback on T2400)
- CI loop iterating `pipelines/smoke/*.smoke.dot`, asserting `exit` event

Estimated ~20% of original work, ~80% of regression-net value. tmux-tester retained as truth source.

### Next step

Recommend reframing illumination as "smoke convention + coverage backfill only". Spin mock mechanism into a separate illumination, deferred unless/until real CI runs prove too slow or flaky — which they currently do not.

User decision pending: approve narrow scope? approve full scope? decline entirely?

## Round 3 — Clarifying questions (T-numbers, prod pipelines, verifier opinion)

### User questions
"What are T1900 T2400 and what is this prod-pipeline you are talking about? Also why verifier node in this pipeline verified this node if you aggree that this is feature-creep?"

### Answers given

- **T-numbers** = shorthand for sibling illumination filenames by timestamp:
  - T1900 → `meditations/illuminations/2026-04-20T1900-path-sensitive-var-flow-validator.md`
  - T2400 → `meditations/illuminations/2026-04-20T2400-split-validate-and-lint-lanes.md`
  - Also T2100 (scaffold-agent), T2200 (explicit consumes). Current illumination depends on all four — stacking concern.
- **"Prod pipeline"** = the 5 real pipelines under `pipelines/*.dot`: `gate-test`, `structured-output-test`, `poc-implement`, `illumination-to-plan`, `illumination-to-implementation`. Vs. `pipelines/smoke/*.dot` = 14 engine-feature test pipelines.
- **Verifier vs. human judgment gap:** verifier's job is fact-check. It correctly confirmed the claimed gap exists (1/5 prod pipelines have smoke coverage, no spec file, no `--mock` flag). Verifier overreached one sentence ("not feature-creep") — that is a judgment call, not a factual claim. It weighed alignment with neighbor illuminations (T1900, T2400) but did not weigh implementation cost, project philosophy (tmux-tester as semantic-drift detector), or the 4-illumination dependency chain. "Genuine gap exists" and "proposed fix is oversized" are both true simultaneously. Scope/cost/philosophy = human judgment step, which is this chat round.

## Round 4 — Mock-target scope clarified

### User question
"Ah so now I finally understand that the moc pipelines are only for these long running pipelines that are meant to be used. Not for smoke pipelines and not for tmux tester to test after implementation has been made? Am I correct?"

### Clarification given

User close, with one twist. Prod pipelines themselves are **never mocked** — they always run real. Mocks target **smoke twins of prod pipelines** (`pipelines/smoke/<name>.smoke.dot` + `<node-id>.mock.json`).

| Layer | Runs real agents? | Mocked? |
|---|---|---|
| Prod pipelines (`pipelines/*.dot`) | Yes, always | Never |
| Smoke twins (proposed `.smoke.dot`) | Unclear under proposal | Yes, in CI |
| tmux-tester today | Yes | — |
| tmux-tester under proposal | Unspecified | — |

Proposal does not resolve how tmux-tester's current real-agent semantic-drift signal survives if existing 14 smoke `.dot` files migrate to mocked `.smoke.dot`. That unresolved ambiguity is the heart of user's objection. Reinforces decline.

## Round 5 — Verdict requested

### Verdict: Decline. Archive.

Reasons:

1. **Feature creep real.** 3 net-new mechanisms (`--mock` flag, `.mock.json` convention, per-branch mock dirs) + 4-illumination dependency chain (T1900/T2100/T2200/T2400) for a coverage problem solvable by writing 4 real smoke twins.
2. **Mocks undercut tmux-tester signal.** Proposal never resolves how semantic-drift detection survives. User's instinct load-bearing.
3. **Zero harm in declining.** Nothing breaks. 14 existing smoke pipelines keep running. Coverage gap becomes tactical backlog — any contributor fills in ~30 min per twin, no framework needed.
4. **Convention documentation trivial.** 5-line `pipelines/smoke/README.md` sufficient if/when contributor confusion surfaces. Doesn't require illumination ceremony.

### Alternative path (no illumination needed)

- Write missing real smoke twins opportunistically: `gate-test`, `structured-output-test`, `illumination-to-plan`, `illumination-to-implementation`.
- Add short `pipelines/smoke/README.md` on demand.
- Revisit mock mechanism only if real CI becomes too slow/flaky — currently neither is true.

## Round 6 — User confirms decline

### User decision
"Yep let's decline and archive this illumination"

### Final outcome

- **Decision:** Decline + archive
- **Archive reason (short):** Feature creep + mock mechanism undercuts tmux-tester signal
- **Preserved value:** Coverage gap noted (4/5 prod pipelines without real smoke twin) — tactical backlog, not illumination-scope
- **No code changes** this run. No spec added. No pipeline file modified.
- Idea preserved in archived illumination if future CI pain ever changes the calculus.
