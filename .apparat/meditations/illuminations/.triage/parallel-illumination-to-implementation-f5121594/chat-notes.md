# Chat round notes — 2026-05-13T16:50

## What the user raised

- Trash vs value: ".apparat folder for example meditations folder is full of valuable project related files notes.md is valuable mostly the trash comes when running the pipelines and middle states are stored so the real question is what files pipelines create mid-flight that is trash that should get cleaned"
- Preserved scratch can still hold value: "even for the scrapped things I think that those can be valuable in the cases for example something goes wrong. We should really think this deeper. In ../verba-extension/.apparat/runs and reasoning-memory I for example store very valuable files for that project."
- Preferred shape: "the safest solution would just be a cli command from where user can select which folders to clean ? command -> shows the folders in apparat and how much stuff those have -> select the ones wants to clean"
- Name correction: "janitor is pipeline command so this command should not be janitor something"
- Verb chosen: "apparat sweep good"

## Conclusions reached

- **Drop the automatic failure-bucket reaper** (`APPARAT_FAILED_KEEP=5` from the illumination).
  - Came from: preserved scratch can still hold value.
  - Rationale: user pointed at `verba-extension/.apparat/runs/` + `reasoning-memory/` as examples where failed-run scratch is the seed for distilled lessons; silent auto-eviction of failures destroys that forensic value before the operator can triage.

- **Drop the `pipeline validate` rule** that would force every new `.apparat/<thing>/` dir to declare a reaper in an ADR.
  - Came from: trash vs value reframe — not every `.apparat/<thing>/` is reapable.
  - Rationale: with no uniform reaper-per-substrate policy, the invariant has nothing to enforce.

- **Ship a single interactive command: `apparat sweep`.**
  - Came from: preferred shape ("a cli command from where user can select which folders to clean").
  - Rationale: operator visibility + manual selection is the safest design; nothing is destroyed without the operator picking it.

- **Command verb is `apparat sweep`, top-level, not under `pipeline`, not named `janitor`.**
  - Came from: name correction.
  - Rationale: `janitor` is already the name of the read-only scanner pipeline; reusing it on a mutating CLI is a collision.

- **Kill the `.apparat/sessions/` producer + consumer in both pipelines.**
  - Came from: trash vs value reframe (sessions are written by pipelines mid-flight and have zero consumer per `.apparat/notes.md` operator note).
  - Rationale: producer-without-consumer is pure token + git-history waste, separate from the sweep CLI question. Memory-writer also commits + pushes the dead file, so killing it stops upstream pollution too.

- **Keep ADR-0015's green-run auto-reaper** (`gcRunScopedArtefactsOnSuccess`).
  - Came from: implied by "trash comes when running the pipelines and middle states are stored" — green-run scratch is exactly that, and ADR-0015 already reaps it correctly.
  - Rationale: it already works; manual sweep is added alongside, not as a replacement.

- **Fix the stimuli/.triage/ omission in `gcRunScopedArtefactsOnSuccess`.**
  - Came from: implicit in the trash-vs-value framing — `meditations/stimuli/.triage/<runId>/` is the same shape of mid-flight scratch as `meditations/illuminations/.triage/<runId>/` and the green reaper currently misses it.
  - Rationale: real bug in the existing reaper, surfaced by counting 14 dirs in stimuli/.triage/ today.

- **Substrate taxonomy used by `apparat sweep`:** curated (`meditations/illuminations/*.md`, `meditations/stimuli/*.md`, `pipelines/<name>/`, `scenarios/`, `notes.md`, `lessons/`, `reasoning-memory/`) vs scratch (`runs/<runId>/`, both `.triage/<runId>/`, `sessions/`).
  - Came from: trash vs value reframe + verba-extension reference layout.
  - Rationale: curated entries are named, frontmattered, human-authored knowledge — never reaped by default. Scratch entries are run-id keyed and have no human-meaningful name. The sweep command can show both, but tags them so the operator does not accidentally nuke knowledge.

- **Implementation split into three PRs.**
  - Came from: preferred-shape + name-correction discussion converging on small, separable units.
  - Rationale: (1) sessions kill is isolated and immediately reduces token + git waste; (2) `apparat sweep` is a pure addition with no behavior change to running pipelines; (3) stimuli/.triage/ fix is a one-liner in the existing reaper. Keeping them separate makes each revertable.

## Open questions

- **Pre-rule sediment cleanup** (94 runs, 18 illumination triages, 14 stimuli triages, 56 sessions): leave for the operator's first `apparat sweep` run to clean, or one-shot chore commit? — deferred because the sweep CLI itself answers it (operator runs sweep once and picks everything pre-rule).
- **Granularity inside a folder**: pick whole folder, or per-item / "keep newest N" / "older than N days"? — deferred; default to whole-folder for v1, add filters later if needed.
- **`lessons/` vs `reasoning-memory/` as canonical curated paths**: verba-extension has both, apparatus has neither. Should apparat ship a canonical promotion path beyond `meditations/`? — deferred; not in scope for the sweep CLI, project-specific convention for now.
- **Promotion convention** (writing a distilled .md that references `derived_from_run_id` before reaping scratch): documented in ADR-0016 prose or left to project convention? — deferred; the sweep command does not need it to ship.

# Chat round notes — 2026-05-16T1333

## What the user raised

- Sliding-window glitch confirmation: user reviewed the thought experiment and confirmed understanding of how `viewStart` recomputes on every cursor move, causing text to jump.
- Textarea vs custom component: "Can I ask why not just use text area? Wouldn't that be easier for input?"
- Community package dismissed: "Forget community package. We can do textarea fast if needed."
- Approach recommendation: user asked which is easier to implement and debug later — chunk-split vs textarea-from-scratch.
- Tmux pane resize durability: "is chunk split also durable for different sized screen widths? For example I can have three tmux panes splitting the screen to smaller width panes."

## Conclusions reached

- **Use chunk-split approach (as illumination describes), not a full textarea-from-scratch.**
  - Came from: recommendation question — which is easier to debug later.
  - Rationale: flat buffer + integer division (`row = cursor / wrapWidth`, `col = cursor % wrapWidth`) means cursor position is always deterministic from one number. A textarea with a line array requires tracking insertions/deletions across line boundaries and reflow on resize — more edge cases.

- **No community package for textarea.**
  - Came from: "Forget community package."
  - Rationale: user dismissed it; build custom.

- **Chunk-split is durable across tmux pane widths.**
  - Came from: tmux pane resize question.
  - Rationale: `wrapWidth` is computed from `process.stdout.columns` on every render; Ink re-renders on `SIGWINCH`; flat cursor index remaps to new `wrapWidth` automatically. No line-array reflow needed. Same pattern already proven in `TextInput.tsx:114`.

## Open questions

- None. Scope confirmed: new `MultilineTextInput` component (chunk-split), swap at `agentDriver.renderFooter`, port test file. `TextInput.tsx` stays untouched.
