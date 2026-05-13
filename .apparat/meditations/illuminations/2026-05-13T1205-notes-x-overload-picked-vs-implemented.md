---
date: 2026-05-13
description: `.apparat/notes.md` uses `- [x]` to mean two different things — "meditation picked this idea" and "operator shipped this" — and the steer flow `meditate <project> --steer "focus on notes.md if not already marked"` proves the operator treats `[x]` as a done-signal, even though all six current notes are marked and at least three of them are not implemented (pipeline-show still doesn't open SVG, parallel pipeline still wires memory_writer+memory_reflector, .apparat/sessions/ still has 50+ files).
---

## Core Idea

`.apparat/notes.md` overloads `- [x]` with two incompatible meanings — "meditation drew on this idea" (per `docs/superpowers/specs/2026-05-12-notes-design.md` and the `mark_note_picked` commit "meditate: mark note picked") AND "the operator shipped this" (universal `[x]` convention everywhere else). Today all six notes are `[x]` but at least three of the implementations they describe are still not shipped, so the checkbox lies to whichever party reads it. The session's own steer text — "focus on .apparat/notes.md if not already marked" — is the smoking gun: the operator authoring the steer mentally read `[x]` as *done*, when the tool only ever meant *picked*.

## Why It Matters

Concrete drift right now (all on disk, easy to verify):

- **Note:** *"Pipeline show command should... open the svg automatically in firefox"* → `[x]` → captured by illumination `2026-05-12T2324-inner-loop-ergonomics-debt.md`, but `src/cli/commands/pipeline/show.ts` ends with `output.success(\`Wrote ${...}.svg\`)` — no `open`/`xdg-open`/`spawn` anywhere. **Not shipped.**
- **Note:** *"instead of using memory writer and memory reflector in the tail there should be a node that checks that README.md..."* → `[x]` → captured by `2026-05-12T2255-doc-drift-tail-for-parallel-implementation.md`, but `.apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot` lines 53–55 still declare both `memory_writer` and `memory_reflector` nodes, and line 91 still wires `memory_writer -> memory_reflector -> done`. **Not shipped.**
- **Note:** *"We should get rid off memory-writer writing memories in .apparat session folder"* → `[x]` → captured by the same illumination, but `.apparat/sessions/` still holds 54 files from 2026-04-13 onward. **Not shipped.**
- **Note:** *"...how to pipelines' agents frontmatters could decide which model to use"* → `[x]` → captured by `2026-05-12T2354-model-and-thinking-as-first-class-frontmatter.md`, but no schema/agent change has landed (the illumination is explicitly the design step, not the shipped change).

The collision is now load-bearing because the operator just *wrote a steer* that depends on `[x]` meaning "done." If meditate ever gains a project-orientation preflight (per the open `2026-05-13T0736-meditate-no-project-orientation-and-mcp-orphans` illumination), the natural next step is "auto-meditate on unmarked notes" — which would silently re-meditate on already-picked notes whose work hasn't shipped, because the marker is wrong about the question being asked.

Tied to the project's vision (`VISION.md`: "running a pipeline feels like delegating to someone who already understands the shape of the problem"): the notes lifecycle is exactly that delegation surface — the *one* place the operator hand-edits to bias future agent runs — and it's the surface most at risk of subtle mis-cueing. Compare to the illumination lifecycle, which is unambiguous: `consume` deletes the file. Two states, two transitions, no overloaded glyph.

This is a small-on-the-surface, large-in-blast-radius bug: applying the **deep-modules** lens, the `notes.md` interface (a checkbox) is shallow because it carries less meaning than the caller — meditation, operator, and future pipelines — has to infer. The fix is to **deepen** by separating picked-state from implemented-state, hiding the tracking inside the tool surface, and presenting one truthful glyph at the operator-readable layer.

## Revised Implementation Steps

1. **Pick a vocabulary, write it down.** Decide whether the model has two states (`open` / `picked`) or three (`open` / `picked-not-implemented` / `implemented`). Three is the honest count — illuminations and plans already have it via the `consume` lifecycle. Update `docs/superpowers/specs/2026-05-12-notes-design.md` with the chosen vocabulary in one sentence and link this illumination as the rationale.

2. **Stop overloading `[x]`.** In `src/cli/mcp/illumination-server.ts:markNotePicked` (around the `lines[i] = \`${m[1]}- [x] ${m[2]}\`` line), change the picked marker to something visually distinct — `- [~] <text>` (in-flight) or `- [→] <text>` (handed-off) — and add a `CLOSED_NOTE_PREFIX_RE` for *implemented* via `- [x]`. Update `parseOpenNotes` to skip both. Update the tool description string passed to `server.tool("mark_note_picked", ...)` so the agent sees the new glyph.

3. **Add `mark_note_implemented`.** Mirror `consume`'s shape: an explicit second tool that flips `- [~] <text>` → `- [x] <text>` and commits with `meditate: mark note implemented`. Wire it into the illumination-to-implementation pipeline tail (the same node that does `consume implemented`) — when an illumination ships, if its filename is recorded in a frontmatter pointer back to a note, the note is closed in the same commit. Until that pointer exists, leave the tool callable manually.

4. **Add the back-pointer.** Today the linkage between a note and the illumination it spawned is prose-only ("the illumination body may quote / reference the note verbatim" — design doc, "What is explicitly not included"). That decision was right for v1, wrong now. Add an optional `from_note:` field to illumination frontmatter; teach `meditate.md` step 8 to include it when a note anchored the session; teach `consume` to call `mark_note_implemented` on that note when reason is `implemented`. This closes the loop without requiring a separate operator action.

5. **Fix the latent steer-flow ambiguity.** Update `src/cli/pipelines/meditate/meditate.md`'s task list (the inserted "Look at `<read_notes_notes>`" step) and the description of `mark_note_picked` in `read_notes.mjs`'s help text so the agent's mental model matches the new vocabulary. Add one sentence in `meditate.md`: "Picked-but-not-implemented notes appear here as `- [~]`; treat them as *still in flight* — do not re-anchor unless you have a materially new angle."

6. **Audit current `[x]` notes once.** Walk `.apparat/notes.md` against the three concrete drifts listed above (show.ts open-SVG, parallel-impl tail rewrite, sessions GC). For each: if shipped, leave `[x]`; if not shipped, hand-edit to `[~]` so the file matches the new semantic immediately. One-time, ~5 minutes — establishes the invariant going forward.

7. **(Optional, defer-ready) Operator-author surface.** Once the three-state model exists, `apparat note add "..."` becomes trivial and the loop closes — but per the design doc, v1 explicitly excludes this. Keep deferred; revisit only after step 4 lands.
