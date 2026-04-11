# Tmux Drive Harness — Design

**Date:** 2026-04-14
**Status:** Draft — pending implementation plan
**Owner:** Claude (primary consumer), authored collaboratively
**Scope:** A documentation artifact + filesystem conventions that let Claude autonomously drive ralph-cli inside tmux, observe its Ink-based TUI, interact with it, and analyze the results — without adding code, dependencies, or MCP servers.

## Problem

Ralph-cli has accumulated a backlog of interactive-overlay and pipeline-display bugs that are hard to reproduce and harder to verify a fix for. They live in the Ink TUI layer, which is inherently unsuitable for scripted scenario tests: output is non-deterministic in timing, overlays steal focus, and asserting on raw terminal state is awkward.

The developer runs their work inside tmux. Tmux already exposes two primitives that together make TUI observation tractable:

1. `tmux capture-pane` — snapshot the current pane contents (text, optionally with ANSI escape codes preserved).
2. `tmux send-keys` — inject keystrokes or literal text into a pane's stdin.

Claude can invoke both via Bash. What's missing is a disciplined **pattern**: where to run ralph, how to know when to capture, how to know when the UI is stable, where to put the artifacts, and how to clean up. Each debugging session currently starts from scratch because no persistent guide exists.

## Goal

Give Claude a single, always-current guide that makes driving ralph in tmux feel as natural as reading a file. The guide must:

- Be invoked by running Bash commands only — no new CLI subcommand, no MCP server, no new npm dependency.
- Not interfere with the developer's working tmux windows.
- Produce artifacts that Claude can re-read across tool calls with minimal friction.
- Be robust to UI evolution (the guide must not rot every time a component renames a string).
- Be honest about its limitations so Claude does not waste time chasing tooling bugs instead of ralph bugs.

## Non-Goals

- **Automated regression testing.** The existing `run-scenarios` command covers Claude-driven scenario tests on user projects. This harness is a dev-time debugging tool for Claude working on ralph itself.
- **A reusable library or subcommand.** No `ralph drive` subcommand, no Node code. The entire deliverable is Markdown + shell snippets.
- **Cross-platform support.** This targets macOS (the developer's environment). The `screencapture` path is macOS-specific; the rest of the patterns are portable but not validated elsewhere.
- **Visual regression pixel diffing.** Screenshots exist for Claude's ad-hoc visual reasoning, not for automated comparison.
- **A markers catalog.** An earlier draft proposed a static table mapping UI states to string patterns. It was dropped because Ink output evolves and a static catalog would rot. Source grep at the moment of use is the replacement.

## Architecture

Three layers, all documentation and filesystem — no executable artifacts committed to ralph-cli itself.

### Layer 1: The Patterns Document

A single Markdown file at `docs/harness/tmux-drive.md` (to be created during implementation) that Claude reads at the start of every debugging session. It contains:

- The six copy-pasteable Bash patterns (start, capture, wait-stable, wait-for-source-grep, send-input, cleanup).
- The optional screenshot flow (section "Visual Capture").
- The known-limitations section (section "Gotchas").
- One-liner recovery commands for orphaned windows and scratchpad pruning.

The document is authoritative. Claude does not memorize the snippets — it re-reads the document at each session start because Ink and tmux behaviors evolve and stale memory is a bug source.

### Layer 2: On-Disk Scratchpad

All run artifacts live under `~/.ralph/harness/<run-id>/`. This slots in next to the existing `~/.ralph/runs/` (pipeline run logs), `~/.ralph/agents/`, `~/.ralph/logs/`, and `~/.ralph/pids/` — same global-scratch category, same convention. `~/.ralph/` is created and managed by the daemon; the harness merely adds a sibling subdirectory.

Layout for a single run:

```
~/.ralph/harness/drive-1712950000/
├── meta.json         # session, window, pid, command, pane size, start/end, exit reason
├── events.log        # chronological action trail, plain text, one line per action
├── current.txt       # latest capture, ANSI-stripped (default read path)
├── current.ansi      # latest capture, ANSI-preserved (escalation path)
├── capture-001.txt   # archive, ANSI-stripped
├── capture-001.ansi  # archive, ANSI-preserved
├── capture-002.txt
├── capture-002.ansi
├── capture-007.png   # only when Claude explicitly requests a screenshot
└── ...
```

Key conventions:

- **`<run-id>` format:** `drive-<unix-timestamp>`. Sortable, unique enough for one debugging session.
- **`current.*` files** are overwritten on every capture. The "what does the UI look like right now?" path is one Read call on `current.txt` — no sorting, no globbing, no index math.
- **Archived numbered captures** support retrospective diffs (`diff capture-005.txt capture-006.txt`).
- **`.txt` and `.ansi` are always written together.** Default analysis uses `.txt` (clean for the Read tool). `.ansi` is there when colors or cursor state matter.
- **`.png` is opt-in.** Screenshots are disruptive (they require briefly switching tmux windows) and their usefulness is situational. They are produced only when Claude explicitly invokes the screenshot helper.
- **`events.log` is plain text**, one action per line: `ISO-timestamp action details`. Grep-friendly and Read-tool-clean. Example: `2026-04-14T12:00:03Z send-keys "hello world" Enter`.
- **`meta.json` is written once at start and updated on cleanup.** Fields: `session`, `window`, `window_index`, `pid`, `command`, `pane_size` (e.g., `"120x36"`), `started`, `ended`, `exit_reason` (`"clean"`, `"aborted"`, `"orphaned"`).

### Layer 3: Memory Pointer

A thin pointer in `MEMORY.md` referencing the patterns document, so Claude discovers it without having to guess. One or two lines:

> **Tmux debugging harness:** Read `docs/harness/tmux-drive.md` at the start of any session that needs to observe ralph's Ink TUI. Scratchpad at `~/.ralph/harness/<run-id>/`.

No detailed patterns in memory. The memory pointer is a discoverability aid; the document is the source of truth.

## The Six Core Patterns

Each pattern below is the skeleton that will appear in `docs/harness/tmux-drive.md` as a copy-pasteable snippet with inline comments. They are reproduced here for spec completeness — the implementation plan will flesh them out with final flags, error handling, and examples.

### Pattern 1 — Start a Run

Detect the developer's current tmux session, mint a run ID, create a new window without stealing focus, record metadata, and launch the ralph command in the new window.

```bash
RUN_ID="drive-$(date +%s)"
SESSION=$(tmux display-message -p '#S')
WIN="ralph-$RUN_ID"
RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
mkdir -p "$RUN_DIR"

# -d = don't steal focus from the user's current window
tmux new-window -t "$SESSION" -n "$WIN" -d

# Capture pane size as rendered so we know what geometry Ink sees
PANE_SIZE=$(tmux display-message -t "$SESSION:$WIN" -p '#{pane_width}x#{pane_height}')

cat > "$RUN_DIR/meta.json" <<EOF
{
  "session": "$SESSION",
  "window": "$WIN",
  "run_id": "$RUN_ID",
  "pane_size": "$PANE_SIZE",
  "started": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "<filled at launch>"
}
EOF

# Launch the command. send-keys with literal Enter presses Return.
tmux send-keys -t "$SESSION:$WIN" "cd /path/to/project && ralph pipeline run foo.dot" Enter
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start window=$WIN" >> "$RUN_DIR/events.log"
```

### Pattern 2 — Capture

Write both text and ANSI-preserved versions, update both `current.*` files and the next numbered archive.

```bash
# Caller tracks the counter; simplest form shown
N=$(printf "%03d" "$CAPTURE_INDEX")

# ANSI-stripped (default analysis path)
tmux capture-pane -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$N.txt"
cp "$RUN_DIR/capture-$N.txt" "$RUN_DIR/current.txt"

# ANSI-preserved (escalation path; `-e` preserves escape sequences)
tmux capture-pane -e -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$N.ansi"
cp "$RUN_DIR/capture-$N.ansi" "$RUN_DIR/current.ansi"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) capture $N" >> "$RUN_DIR/events.log"
```

### Pattern 3 — Wait for Stable UI (primary waiter)

Poll the pane, compare each capture to the previous one, declare stable when two consecutive captures are identical. This is the default synchronization primitive and works for every Ink surface without knowing what is being rendered. Timeout is configurable; the default in the document will be 10 seconds with 200ms polls.

```bash
wait_stable() {
  local budget_ms=${1:-10000}
  local interval_ms=200
  local elapsed=0
  local prev=""
  while [ "$elapsed" -lt "$budget_ms" ]; do
    local now
    now=$(tmux capture-pane -p -t "$SESSION:$WIN")
    if [ -n "$prev" ] && [ "$prev" = "$now" ]; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable elapsed=${elapsed}ms" >> "$RUN_DIR/events.log"
      return 0
    fi
    prev="$now"
    sleep 0.2
    elapsed=$((elapsed + interval_ms))
  done
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable TIMEOUT elapsed=${elapsed}ms" >> "$RUN_DIR/events.log"
  return 1
}
```

### Pattern 4 — Wait for a Precise State via Source Grep (rare, opt-in)

When "stable" is not enough (e.g., Claude needs to distinguish "overlay is ready for input" from "overlay is still opening its box"), Claude grabs the literal string the component currently renders by grepping the source, then waits for that string to appear in a pane capture. No hardcoded markers; the source of truth is the code.

```bash
# Example: find the current submit hint string used by ChatUI
HINT=$(grep -rh "Press" src/cli/lib/ src/cli/commands/ | grep -i "submit" | head -1 | sed 's/.*"\(.*\)".*/\1/')
# Then poll until that exact substring appears in a capture, bounded by a timeout.
```

The document will include a reusable `wait_for_string "<needle>" <budget_ms>` helper and a list of the source directories worth grepping (`src/cli/lib/output.ts`, `src/attractor/handlers/`, `src/cli/commands/`, `src/cli/mcp/`).

### Pattern 5 — Send Input

Literal text payloads use `send-keys -l` to avoid shell-like parsing. Control keys use the explicit tmux names (`Enter`, `Escape`, `C-c`, `Tab`, `BSpace`). The discipline is: **always `wait_stable` before and after `send-keys`**, because tmux delivers the input instantly but Ink may not have a reader ready.

```bash
wait_stable || true
tmux send-keys -t "$SESSION:$WIN" -l "hello world"
tmux send-keys -t "$SESSION:$WIN" Enter
wait_stable || true
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) send-keys 'hello world' Enter" >> "$RUN_DIR/events.log"
```

### Pattern 6 — Cleanup

Normal completion closes the harness window, writes end time and exit reason into `meta.json`, and logs the close event. Safe to call even if ralph is mid-run.

```bash
tmux kill-window -t "$SESSION:$WIN" 2>/dev/null || true
# meta.json update done via a small jq/python snippet documented in the patterns file.
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) cleanup exit_reason=clean" >> "$RUN_DIR/events.log"
```

A separate **recovery** snippet lists and offers to kill orphaned `ralph-drive-*` windows whose runs never wrote an `ended` timestamp. Claude runs it at session start if the previous session crashed.

### Visual Capture (opt-in)

Screenshots are produced by briefly switching the developer's view to the harness window, running `screencapture`, and switching back. The flow records the previously-active window index so the switch is invisible except for a brief flash.

```bash
CURRENT=$(tmux display-message -p '#I')
tmux select-window -t "$SESSION:$WIN"
sleep 0.3  # let terminal emulator redraw
screencapture -o -x "$RUN_DIR/capture-$N.png"
tmux select-window -t "$SESSION:$CURRENT"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) screenshot $N" >> "$RUN_DIR/events.log"
```

Before running, the helper validates that the frontmost application is a known terminal emulator (via `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`). If not, it aborts with an explanatory message rather than capturing the wrong window.

## Gotchas (Known Limitations)

These will appear as a dedicated section in the patterns document so Claude does not re-discover them.

1. **Screenshots require terminal focus.** `screencapture` captures whatever is currently on screen. The helper checks `frontApp` via AppleScript and aborts if it is not a known terminal emulator. Even then, the capture reflects the current view, not the "harness window in isolation."
2. **Pane size comes from the attached client.** If multiple clients are attached at different sizes, Ink wraps at the smallest. `meta.json` records `pane_size` so Claude can reason about geometry-sensitive bugs.
3. **`current.txt` is racy with in-flight renders.** A one-shot capture called mid-render shows a half-drawn frame. Rule: always go through `wait_stable` before treating `current.txt` as authoritative.
4. **`send-keys` is instantaneous.** Ink may not have a reader ready at that moment. Always `wait_stable` before and after `send-keys`.
5. **Long payloads need `-l`.** Spaces, quotes, and `$` are parsed by tmux unless `send-keys -l` is used. Control keys (`Enter`, `Escape`, etc.) must be sent as separate `send-keys` arguments.
6. **No auto-cleanup of scratchpad.** Runs accumulate under `~/.ralph/harness/`. Prune manually: `find ~/.ralph/harness -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +`.
7. **Abort leaves orphaned windows.** If a debugging session crashes mid-run, the tmux window stays open and `meta.json` has no `ended` field. The recovery snippet lists and kills orphans on request.
8. **macOS only for screenshots.** The text-capture and send-input patterns are portable; the `screencapture` helper is not. Linux/other-platform support is explicitly out of scope.

## Integration Points

The harness is decoupled from ralph-cli source code. It interacts with ralph through exactly three surfaces:

- **Process boundary:** `tmux send-keys "ralph ..."` launches ralph like any other command. Ralph does not know or care that it is running under the harness.
- **Filesystem boundary:** the harness writes into `~/.ralph/harness/`, which is a sibling of `~/.ralph/runs/`, `~/.ralph/agents/`, etc. No existing ralph code reads from `~/.ralph/harness/`; the daemon's `getRalphDir()` helper is not modified.
- **Source-grep boundary:** pattern 4 reads `src/**/*.{ts,tsx}` at debug time to find live string literals. This is one-way: the harness depends on ralph source, ralph source does not depend on the harness.

No ralph-cli code changes are required by this design. If future ralph features need to cooperate with the harness (e.g., writing a ready-marker to a known file), that is a future extension covered by its own design, not this one.

## Documentation Artifacts to Produce (Implementation Scope)

The implementation plan will produce, at minimum:

1. **`docs/harness/tmux-drive.md`** — the patterns document. Sections: "When to use this", "Setup and preconditions", "The six patterns" (each as a runnable snippet with comments), "Visual capture", "Gotchas", "Recovery", "Pruning".
2. **A memory pointer** added to `MEMORY.md` under a "Harness" subsection with a one-sentence blurb plus the doc path.
3. **A brief note in `CLAUDE.md`** (project instructions) pointing future sessions to the patterns document when debugging TUI behavior. This ensures the harness is discoverable even in fresh sessions without preloaded memory.

No source code changes. No new npm dependencies. No MCP server. No binary files other than screenshots produced at runtime.

## Testing Strategy

Because the deliverable is documentation + filesystem conventions, testing is manual and lightweight:

1. **Smoke test 1 — round trip a trivial command.** Follow the patterns document to launch `ralph --help` in a new harness window, capture, verify `current.txt` contains expected text, clean up. Confirms patterns 1, 2, 3, 6 work.
2. **Smoke test 2 — interactive pipeline.** Launch `ralph pipeline run <dot-with-wait-human>`, wait stable, send a decision label, wait stable, verify the pipeline advances. Confirms patterns 4, 5 work against the real ChatUI overlay.
3. **Smoke test 3 — orphan recovery.** Intentionally kill a harness mid-run, then run the recovery snippet and verify the orphan window is surfaced and killable.
4. **Smoke test 4 — visual capture.** Run the screenshot helper, verify a non-empty PNG lands at the expected path, verify `events.log` records the screenshot event, verify the developer's active window is restored.

Each smoke test is a sequence of Bash commands from the patterns document. If a smoke test requires workarounds beyond what the document specifies, the document is wrong and must be fixed before the test is considered passing.

## Success Criteria

- Claude, starting a fresh session with no preloaded memory about this harness, can find the patterns document from `CLAUDE.md` within two tool calls.
- Following only the document, Claude can drive a pipeline run, interact with its overlay, and produce captures for analysis — without reading any ralph-cli source code to figure out how tmux works.
- The developer's existing tmux windows are never touched. The only visible artifact of a harness run is the brief window-switch during a visual capture, if one is requested.
- A week later, after Ink components have been renamed or refactored, the harness still works because pattern 4 grabs strings from the source at runtime rather than from a stale catalog.

## Open Questions

None. All previously-raised ambiguities (session scope, interaction interface, observation scope, synchronization strategy, visual capture approach, scratchpad location, and catalog rot) were resolved during brainstorming.
