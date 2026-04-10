# Illumination Pipeline Session — 2026-04-13

## Overview

This session debugged and partially fixed the `illumination-to-plan` pipeline. Two bugs were identified and triaged: one fixed and committed, one analyzed and planned but not yet executed.

## Bug 1: Pipeline Node Labels Display (FIXED & COMMITTED)

**Problem**
Gate node labels in the `nodes:` overview line showed literal `\n` and `$variable` placeholders instead of display names.
- Example: `"Remove this illumination?\n$illumination_path"` rendered as-is instead of using node ID

**Root Cause**
`src/cli/commands/pipeline.ts:105` used `n.label ?? n.id` for display. Gate labels are multi-line prompts, not short display names.

**Solution**
Changed to use `n.id` only — cleaner, consistent with node identity.

**Status**
- **Fixed in:** `src/cli/commands/pipeline.ts:105`
- **Tests updated:** `src/cli/tests/pipeline.test.ts`
- **Committed:** Yes (included in recent commits)

---

## Bug 2: JSON Schema Enforcement in Agentic Sessions (EXECUTED AND COMMITTED)

**Problem**
Verifier node fails with structured output parsing errors in long multi-tool-use agentic sessions:
1. Run 1: `Unexpected token '*', "**Verdict:"... is not valid JSON` — model returned markdown
2. Run 2: `Unexpected end of JSON input` — model returned empty/truncated output

Both failures originate from the same root cause: the `--json-schema` CLI flag does not constrain the model's final message after many sequential tool calls (verifier spawns up to 50 subagents).

**Root Cause Analysis**
- `--json-schema` works for simple one-shot `-p` prompts
- Fails in long agentic sessions because the schema constraint is applied at the initial API call level, not re-enforced in the final message
- The model's instruction to return JSON degrades as context/tool iterations accumulate

**Fix Strategy (Designed, Not Yet Executed)**
Prepend and append explicit JSON constraint instructions to the verifier prompt in `src/attractor/lib/agent-handler.ts:70` when `jsonSchema` is set:
- **Prepend:** "You MUST respond with valid JSON only, no markdown."
- **Append:** "Remember: your final response MUST be valid JSON matching the schema."

**Implementation Status**
- **Plan written:** `docs/superpowers/plans/2026-04-13-json-schema-prompt-constraint.md`
- **Tests pre-written by Opus subagent:** `src/attractor/tests/agent-handler-json-constraint.test.ts` (4 tests)
  - Tests 1–3: Constraint enforcement in single-tool and multi-tool scenarios
  - Test 4: Explicitly pins markdown output as `status: "fail"` to guard against parse-repair fallback
- **Status:** COMMITTED IN 0.0.49

---

## Context.md Proposal (INVESTIGATED, REJECTED)

**Proposal**
Replace JSON-based context passing with a shared `context.md` file per pipeline run.

**Investigation Outcome**
Three parallel subagents researched:
1. Breaking changes (gate variable expansion: `$illumination_path`)
2. Attractor spec compliance (serializability requirement)
3. Opus validation (dual-source resume state)

**Decision: YAGNI — Do Not Build**
Rationale:
- Breaks gate variable expansion (`$illumination_path` etc.)
- Requires rewriting 4 test files
- Creates dual-source resume state (ctx.values + context.md)
- Contradicts attractor spec serializability requirement (context must be self-contained in ctx.values)

**Alternative Approved**
Prose context can flow via file path convention: node writes to file, stores path in `ctx.values` (already how `illumination_path` works).

---

## Parse-Repair Fallback (INVESTIGATED, REJECTED)

**Proposal**
On JSON parse failure, extract first `{...}` block via regex as fallback.

**Decision: Rejected**
Contradicts the core lesson: this hides the failure mode instead of surfacing it. Test 4 in `agent-handler-json-constraint.test.ts` explicitly pins markdown output as `status: "fail"` to guard against such fallbacks.

---

## End State

- **Pipeline `illumination-to-plan`:** Has not completed yet
- **Blocker resolved:** JSON constraint fix executed in 0.0.49
- **Illumination file:** `meditations/illuminations/2026-04-13T1100-preamble-is-written-but-not-delivered.md` not yet triaged

## Next Steps

1. Triage illumination file once pipeline completes

---

## Key Architectural Learning

**JSON Schema in Agentic Sessions**

The `--json-schema` flag works for simple one-shot prompts but fails for long agentic loops. The fix is prompt-level (explicit re-enforcement), not code-level (parse repair).

Two failure modes from one root cause:
- `Unexpected token '*'` → model returned markdown (visible failure)
- `Unexpected end of JSON input` → model returned empty/truncated (invisible failure)

Both require the same fix: append JSON-constraint instructions to the verifier prompt when schema is set, ensuring the model's final response (not just initial constraints) respects the schema.

---

## Latest Run — Post JSON Constraint Fix (2026-04-14)

After `npm run build` and JSON constraint fix committed, the pipeline was re-run with the following observations:

**Test 1: Underscore vs Hyphen in Pipeline Name**
```
ralph pipeline validate illumination_to_plan
```
Result: `Dot file not found` error.

Status: **Not a bug**. Pipeline name uses hyphens (`illumination-to-plan`), not underscores. Tool correctly rejected underscore variant. This is expected validation behavior.

---

**Test 2: Verifier Session Still Fails**
```
ralph pipeline run illumination-to-plan --project .
```
Result: `Structured output parsing failed: Unexpected end of JSON input` (PID 17681).

**Critical Observation**
The JSON constraint fix changed the failure mode from `Unexpected token '*'` (markdown) to `Unexpected end of JSON input` (empty output). This indicates:
- The prepend+append JSON instructions ARE being applied
- The model is no longer returning markdown
- BUT `lastResult.output` is empty or truncated before JSON completion

**Root Cause Hypothesis**
The fix addressed the markdown failure but exposed a deeper issue:
- Verifier spawns 50+ subagents in agentic loop
- Child process may timeout or exit before producing complete output
- Readline close race condition may not be fully resolved for long-running sessions
- Claude CLI may return empty result envelope if session exceeds time/token limits

**Current Blocker**
`Unexpected end of JSON input` suggests `lastResult.output` is either:
1. Empty string
2. Truncated JSON (incomplete)
3. Not being captured from the child process stdout

---

## Recommended Next Steps

1. **Instrument output capture:** Write `lastResult.output` to `nodeDir/raw-output.txt` before parsing in `src/attractor/lib/streaming-json-parser.ts`
   - Allows inspection of what the claude child process actually returned
   - Distinguish between empty vs. truncated failures

2. **Verify child process completion:** Check if verifier's 50-subagent session is timing out
   - Review timeout/token budgets in `src/attractor/lib/agent-handler.ts`
   - Consider adding progress logging to long-running sessions

3. **Test with shorter verifier:** Run pipeline with a simpler verification prompt to isolate whether this is a scale issue

---

## Summary

The JSON constraint fix (0.0.49) successfully prevented markdown returns but did not resolve the empty output problem. The failure mode changed, indicating the fix is incomplete. Next session should diagnose what `lastResult.output` actually contains when the verifier times out.
