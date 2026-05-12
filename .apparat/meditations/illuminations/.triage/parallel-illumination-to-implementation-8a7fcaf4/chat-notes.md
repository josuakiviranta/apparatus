# Chat round notes — 2026-05-12T16:00

## What the user raised
- "I don't understand. Talk normally and explain simply with examples how output would change": user wanted a plain-language explanation grounded in concrete before/after terminal output, not the technical illumination summary.
- "Ah so this is just a refactor. (Verify your claims by studying the codebase)": user reframed the change as a pure refactor and asked for codebase-grounded verification.
- "Which of these gives better architecture and follows more .apparat/meditations/stimuli/deep-modules-hide-complexity.md stimulus?": user asked which of two options (a — TUI byte-identical to `renderFailureFooter`; b — TUI keeps its own margin opinion, only shares content) better follows the deep-modules stimulus.
- "ok (a)": user accepted option (a) — full byte-parity seam.

## Conclusions reached

- The change is a **pure refactor**. No user-visible CLI flags, schema, event-emission, or public API changes; `renderFailureFooter` keeps its `string`-with-trailing-`\n` contract (pinned by `failure-handoff.test.ts:80` `endsWith("\n")`).
  - Came from: "Ah so this is just a refactor. (Verify your claims by studying the codebase)"
  - Rationale: user wanted the framing confirmed against the codebase before approving; verification of `failure-handoff.ts:42-56`, `PipelineRunView.tsx:223-241`, `commands/pipeline/run.ts:418` stderr path, and the pin tests confirmed zero externally observable behavior change.

- **Option (a) wins** — `renderFailureFooterLines(h): string[]` owns the **complete on-screen shape including blank lines**, and the TUI is pinned byte-for-byte to `renderFailureFooter(handoff)` via a snapshot/parity test. Option (b) — shared content but TUI keeps its own `marginBottom={1}` opinion — is rejected.
  - Came from: "Which of these gives better architecture and follows more deep-modules-hide-complexity.md stimulus?" → "ok (a)"
  - Rationale: the deep-modules stimulus literally names option (b) as the shallow-module symptom ("a concept implemented twice ... with no single seam where they're forced to agree"). Option (a) gives the maintainer locality (every footer change — wording, line order, spacing — lives in `failure-handoff.ts`), gives the caller leverage (interface is `renderFailureFooterLines(h): string[]` + a trivial map), and places one test at one seam (`render(<PipelineRunView handoff={h}/>).lastFrame()` parity with `renderFailureFooter(handoff)`).

- **Pre-existing micro-drift between CLI string and TUI block is a feature, not a bug, of this refactor.** Today the TUI uses `<Text> </Text>` (single space) for the blank line because Ink collapses fully-empty `<Text>`, and the outer `<Box marginBottom={1}>` adds an extra blank line after `resume:` that the CLI string does not produce. Option (a) collapses this drift by routing all spacing decisions through the lines array; the new snapshot test surfaces and fixes it on first run.
  - Came from: user's request to verify byte-parity claim against the codebase, combined with selecting option (a).
  - Rationale: user explicitly chose the option that forces byte-level agreement at the seam. Letting the snapshot test catch the existing micro-drift is the stimulus's "step 4: force agreement through a single seam" working as designed.

- **TUI consumer shape is `lines.map((line, i) => <Text key={i}>{line === "" ? " " : line}</Text>)`** inside a `<Box flexDirection="column">` with **no `marginBottom`** on the outer Box. Any visible margin after `resume:` (if desired) must be expressed by the lines array (e.g. trailing `""`), not by JSX-side margin — keeps the seam authoritative.
  - Came from: user's selection of option (a) plus the codebase verification of the Ink empty-`<Text>` collapsing behavior.
  - Rationale: stimulus's locality requirement — every shape decision belongs in `failure-handoff.ts`; TUI is a dumb mapper.

- **Scope unchanged from the illumination**, modulo the (a) decision above:
  - In: add `renderFailureFooterLines` in `src/cli/lib/failure-handoff.ts`; rewrite the JSX branch in `src/cli/components/PipelineRunView.tsx:223-241` (lib-side range; verifier flagged off-by-one vs illumination's 222-239); new TUI parity test (recommended path `src/cli/tests/pipeline-run-view-failure-handoff.test.tsx`).
  - Out: `src/cli/commands/pipeline/run.ts:418` stderr write path (untouched).
  - Out: schema, ADR, spec edits.
  - Came from: user's "ok (a)" implicitly affirms the existing illumination scope minus the now-resolved option-a-vs-b question.
  - Rationale: user did not push back on any other scope element; option (a) is fully contained in the three-file blast radius the verifier confirmed (S).

## Open questions

- None outstanding. (The trailing-newline contract on `renderFailureFooter` and the "blank line before `resume:`" invariant remain as documented in `failure-handoff.ts:38-40` — option (a) preserves both because the lines array still contains the unconditional `""` entry between `inspect:` and `resume:`.)
