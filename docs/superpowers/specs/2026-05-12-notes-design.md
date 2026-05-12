# Notes — operator-authored steer for meditate

**Date:** 2026-05-12
**Status:** Accepted (single-developer project; no separate review)

## Motivation

Today the only steer surface the operator has into `meditate` is the
`--steer <text>` CLI flag, which is one-shot and ephemeral. There is no
durable, low-ceremony way to drop a thought — "fix the validator hint",
"the auth module feels bloated" — and have meditate weigh it the next
time it runs. Adding such a surface lets future meditate sessions inherit
the operator's running attention list instead of starting from a blank
slate every time.

GitHub issues were considered as the durable medium but rejected for v1:
the workflow we want is "edit a local file, commit, meditate" rather
than "open a browser, file an issue, install gh cli." If issues become
desirable later, they can layer on as an alternative source for the
same `<read_notes_notes>` slot without changing meditate's contract.

## The artefact

A single file: `<project>/.apparat/notes.md`.

- Owned by the operator. Edited by hand.
- Lives inside `.apparat/` because the format and lifecycle are
  apparat-defined (per ADR-0008 partition principle, clause A) and no
  pre-existing ecosystem convention places a "meditate todo file" at
  repo root (clause B).
- Committed to git like illuminations and stimuli — these are durable
  intentions, not local scratch.
- Created by `apparat init` as an empty stub with a one-line comment
  showing the format. Idempotent (never overwritten if present).

### Format

Free-form markdown. The parser cares about exactly two line shapes:

- `- [ ] <text>` — an **open note**
- `- [x] <text>` — a **closed note** (ignored on read)

Everything else is decoration: section headers, paragraphs, blank lines,
nested non-checkbox bullets. The parser scans line-by-line and yields
the trimmed `<text>` of each open note. Whitespace before the dash is
tolerated (`  - [ ] ...` works) so the operator can nest under headers.

## Pipeline integration

Scope for v1: meditate only. Janitor and other pipelines may consume
notes later; the wiring is trivial (one tool-node + an injected
placeholder per pipeline) and intentionally not done now.

### Read path

A new tool-node script `read-notes.mjs` lives at
`src/cli/pipelines/meditate/read-notes.mjs`, sibling to the existing
`read-vision.mjs`. It runs at pipeline start (after `read_vision`) with
`cwd=$project`, reads `.apparat/notes.md` if present, parses open
notes, and emits a single JSON line to stdout:

```json
{"notes": "- fix validator hint\n- audit auth module"}
```

The string is a newline-joined list of open-note bodies (prefix
stripped, bullets re-prefixed with `- ` for readability in the prompt).
If the file is missing or has zero open notes, `notes` is `""` — the
same empty-string contract `read_vision.mjs` uses for absent
`VISION.md`.

`pipeline.dot` declares the node with `produces_from_stdout=true`,
adds an edge `read_vision -> read_notes -> meditate`, and the meditate
agent declares the new input in its frontmatter as `read_notes.notes`.

### Write path

One new MCP tool on the existing illumination server:

```
mark_note_picked(text: string) → { success: bool, ... }
```

Behavior:

- Reads `.apparat/notes.md`.
- Finds the first line matching `- [ ] <text>` where `<text>` matches
  verbatim (after trimming the leading bullet/checkbox).
- Rewrites that line as `- [x] <text>`.
- Stages and commits the change with message
  `meditate: mark note picked`.
- If no match: returns `{ success: false, error: "..." }` — does NOT
  throw. The meditate run continues.
- If the file does not exist: same soft failure.
- Git unavailable / nothing to commit: file edit succeeds, commit
  skipped (matches the fail-open behavior of `writeIllumination` and
  `consume`).

The agent invokes this tool once per note it actually drew on while
composing the illumination. The illumination body may quote / reference
the note verbatim in prose — there is no machine back-link from
illumination filename to note.

## Agent prompt edits

`src/cli/pipelines/meditate/meditate.md`:

1. Frontmatter `inputs:` gains `read_notes.notes`.
2. Tool list gains `mcp__illumination__mark_note_picked`.
3. The "Strategic compass" section gets one more bullet describing
   `<read_notes_notes>`.
4. The "Task" section's existing step list gets one new step inserted
   after "list_illuminations":
   > Look at `<read_notes_notes>`. If any note clearly anchors or
   > steers this session's illumination, plan to call
   > `mark_note_picked(text)` on it after writing.
5. A closing reminder: "Mark each note you actually drew on. Notes
   you did not use stay open for next session."

## What is explicitly not included

- No CLI authoring command (`apparat note add`). The operator edits
  the file by hand.
- No janitor wiring. One-line trivial follow-up.
- No back-link from illumination → note. The link is "consume happens
  at meditate-time."
- No stable note IDs / hashes / HTML comments. Identity is the verbatim
  body text within a single meditate run; cross-run renames mean the
  note stays open (the worst case is mild and self-healing — operator
  flips it manually if it bothers them).
- No `unmark_note_picked` reopen tool. Operator edits the `x` to a
  space.

## Testing

Unit tests (vitest, `src/cli/tests/illumination-server.test.ts`):

- `parseOpenNotes(content)` — extracts `- [ ]` lines, ignores `- [x]`,
  ignores prose, handles leading whitespace, returns `[]` for empty
  or all-closed.
- `markNotePicked(projectRoot, text)`:
  - flips a matching `- [ ]` to `- [x]`
  - leaves other lines untouched
  - returns `{ success: true, ... }` and triggers `git add` + commit
  - returns `{ success: false }` when text doesn't match
  - returns `{ success: false }` when file is missing
  - fail-open on git errors (file change persists)

Init test (`src/cli/tests/init.test.ts`):
- `notes.md` scaffolded with stub content on fresh `apparat init`.
- Existing `notes.md` not overwritten.

Pipeline-graph test (`pipelines-meditate-graph.test.ts`):
- `read_notes` node exists with the expected attributes
- edge `read_vision -> read_notes -> meditate` wired
- meditate agent declares `read_notes.notes` input
- meditate.md body references `<read_notes_notes>`

End-to-end smoke (manual, run once at the end):
- Seed `.apparat/notes.md` with one open note
- Run `apparat meditate .`
- Assert: notes.md line flipped to `[x]`, illumination references the note text in prose.

## Open issues

None for v1.
