# Devil's-Advocate Review: 2026-05-04 Partial Revert of `.ralph/`

**Verdict:** Counter-arguments worth addressing.

The spec is internally coherent but underweights three things: (1) the alternative of patching the symptom rather than the layout; (2) the instability of the partition principle it introduces; (3) the credibility cost of reversing a 7-day-old ADR with no new external evidence.

---

### 1. Skill-landing failure has a cheaper fix the spec dismisses without argument

The motivation rests on third-party skills (`grill-with-docs`, `improve-codebase-architecture`) hard-coding root paths. But §1 never weighs the obvious alternatives: a root-level `CONTEXT-MAP.md` or symlinks (`CONTEXT.md` → `.ralph/CONTEXT.md`), or filing PRs against the skills to teach them about `.ralph/`. The skills are owned by the same operator. "Skill looks → not found → drift" is a skill bug, not a layout bug. Moving a half-dozen files and renaming a public API to accommodate a fixable downstream assumption inverts the dependency arrow. The spec does not consider this and therefore cannot claim it considered the cheapest path.

**Spec's answer:** none.

### 2. The partition principle ("ralph-defined in `.ralph/`; pre-existing at root") is not stable

The rule is "reading a file isn't owning its convention." Fine — but ralph also reads `meditations/`, `pipelines/`, `runs/`, `agents/`. The spec leaves those in `.ralph/` because they are "ralph-defined." This is post-hoc: `meditations/` was a convention ralph adopted from prior work; `pipelines/` is a generic noun. The minute ralph defines a `MEMORY.md` or `GLOSSARY.md` that overlaps with an emerging community convention, the rule will require another partial revert. ADR-0008 is encoding a judgment ("third-party-ness") that has no operational test.

**Spec's answer:** §7.1 acknowledges only the "two ADRs to read" cost. Does not address the leak.

### 3. Reversing ADR-0007 at 7 days devalues ADRs

ADR-0007 had a "Discoverability" trade-off section that already named the exact symptom now being used to reverse it ("ADRs under `.ralph/` reduce outsider discoverability"). The author accepted that trade-off a week ago citing solo-dev. Nothing materially new has happened — no third party complained, no skill ecosystem changed. Reversing on the same evidence makes ADR acceptance look like a draft state. §7.4 hand-waves this as "the system working as designed," but the system that was designed required *new information* to overturn an accepted decision; what we have is *re-evaluation of the same information*.

**Spec's answer:** §7.4 — weak; conflates "ADRs are append-only" with "ADRs are revisable on whim."

### 4. The file selection is post-hoc

CONTEXT.md and docs/adr/ are conventions ralph adopted, not invented. So are `meditations/` (lens-based reflection is older than ralph), `pipelines/` (DAG runners are older), and arguably `runs/`. The spec's "ralph-defined" filter is doing work the test cannot justify. If the criterion is "third-party skills look here," only docs/adr/ and CONTEXT.md qualify; VISION.md is mostly an internal artefact and its inclusion is unmotivated.

**Spec's answer:** none — VISION.md is asserted as third-party convention without citation.

### 5. `memoryDir()` → `sessionsDir()` is gold-plating bundled with the move

The rename touches a public-ish helper, all callers, two pipeline prompts, and ADR text. The justification ("memory is overloaded") is real but orthogonal to the revert. It could ship as a separate commit later, or be deferred. Bundling it inflates the diff and the cognitive cost of reading ADR-0008. §7.3 acknowledges the bundling but defends only atomicity, not necessity.

**Spec's answer:** weak.

### 6. Staged-vs-big-bang is solo-dev LARP

§2 item 8 cites "easier to bisect" and "easier to review." Solo dev, no reviewer, no historical bisect on this codebase. Six commits will land in one push. The cost (six commit messages, six green-CI checkpoints) is real; the benefit is hypothetical.

**Spec's answer:** none.

### 7. `.ralph/scenarios/` is the wrong home for test fixtures

`.ralph/` is "ralph-touchable runtime state." Test fixtures aren't runtime — they're build-time inputs. `src/tests/fixtures/smoke/` is the conventional answer and avoids the noun-overload §7.2 admits. The spec rejects it as "breaks the partition" — but the partition is what's being invented, so the rejection is circular.

**Spec's answer:** §7.2, circular.

---

**Recommendation:** before shipping, the author should (a) explicitly rule out the symlink/CONTEXT-MAP/skill-patch alternatives with one paragraph each, (b) drop the `memoryDir`→`sessionsDir` rename from this change, (c) move `pipelines/smoke/` to `src/tests/fixtures/smoke/` instead of `.ralph/scenarios/`, and (d) state the operational test for "third-party convention" so the partition principle has a falsifiable rule.
