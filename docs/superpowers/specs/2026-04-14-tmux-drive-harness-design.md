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

## Prerequisites

The harness assumes the developer's environment has, and only has:

- **tmux** (the entire mechanism hinges on it).
- **coreutils** as shipped by macOS (`date`, `cp`, `mv`, `mkdir`, `find`, `sed`, `grep`).
- **ripgrep** (`rg`) for pattern 4's source grep. ripgrep is ubiquitous in this developer's workflow; BSD grep is acceptable as a fallback but pattern 4's examples use `rg`.
- **macOS `screencapture`** (built-in) for the optional visual capture flow.

The harness explicitly avoids `jq`, `python`, and any npm dependency. `meta.json` is read and written with bash heredocs and `sed`, not with `jq`. If a future pattern needs structured JSON manipulation, the first question is "can we do this with a plain-text log instead?" before reaching for a new system tool.

## Architecture

Three layers, all documentation and filesystem — no executable artifacts committed to ralph-cli itself.

### Layer 1: The Patterns Document

A single Markdown file at `docs/harness/tmux-drive.md` (to be created during implementation) that Claude reads at the start of every debugging session. The new `docs/harness/` directory is a sibling of the existing `docs/superpowers/` hierarchy and does not conflict with it. It contains:

- The six copy-pasteable Bash patterns (start, capture, wait-stable, wait-for-source-grep, send-input, cleanup).
- The optional screenshot flow (section "Visual Capture").
- The known-limitations section (section "Gotchas").
- One-liner recovery commands for orphaned windows and scratchpad pruning.

The document is authoritative. Claude does not memorize the snippets — it re-reads the document at each session start because Ink and tmux behaviors evolve and stale memory is a bug source.

### Layer 2: On-Disk Scratchpad

All run artifacts live under `~/.ralph/harness/<run-id>/`. This slots in next to the existing `~/.ralph/runs/` (pipeline run logs), `~/.ralph/agents/`, `~/.ralph/logs/`, and `~/.ralph/pids/` — same global-scratch category, same convention. `~/.ralph/` is created and managed by the daemon; the harness merely adds a sibling subdirectory.

Layout for a single run:

```
~/.ralph/harness/drive-1712950000-38291/
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

- **`<run-id>` format:** `drive-<unix-timestamp>-<pid>`. The PID suffix guarantees uniqueness when two runs start in the same second (retry loops, parallel smoke tests, or a test helper that launches two harness windows).
- **`current.*` files** are overwritten atomically on every capture. The capture helper writes to `current.txt.tmp` first, then renames via `mv` — `mv` within the same filesystem is atomic, so a concurrent reader never sees a half-written file. The "what does the UI look like right now?" path is one Read call on `current.txt` — no sorting, no globbing, no index math. `current.txt` is the file the "one Read call" promise refers to; `current.ansi` is the escalation path when colors or cursor state matter.
- **Archived numbered captures** support retrospective diffs (`diff capture-005.txt capture-006.txt`). The capture index is initialized to `0` in Pattern 1 and incremented by Pattern 2 on every capture.
- **`.txt` and `.ansi` are always written together.** Default analysis uses `.txt` (clean for the Read tool). `.ansi` is there when colors or cursor state matter.
- **`.png` is opt-in.** Screenshots are disruptive (they require briefly switching tmux windows) and their usefulness is situational. They are produced only when Claude explicitly invokes the screenshot helper.
- **`events.log` is plain text**, one action per line: `ISO-timestamp action details`. Grep-friendly and Read-tool-clean. Example: `2026-04-14T12:00:03Z send-keys "hello world" Enter`.
- **`meta.json` is written twice:** once at start (with `session`, `window`, `window_index`, `pid`, `command`, `pane_size`, `started`) and once at cleanup (appending `ended`, `exit_reason`). The cleanup update happens *before* `kill-window` so a failed update does not leave the window dead with no audit trail. `pane_size` is the size at start; Gotcha 2 documents the drift caveat.

### Layer 3: Memory Pointer

A thin pointer in `MEMORY.md` referencing the patterns document, so Claude discovers it without having to guess. One or two lines:

> **Tmux debugging harness:** Read `docs/harness/tmux-drive.md` at the start of any session that needs to observe ralph's Ink TUI. Scratchpad at `~/.ralph/harness/<run-id>/`.

No detailed patterns in memory. The memory pointer is a discoverability aid; the document is the source of truth.

## The Six Core Patterns

Each pattern below is the skeleton that will appear in `docs/harness/tmux-drive.md` as a copy-pasteable snippet with inline comments. They are reproduced here for spec completeness — the implementation plan will flesh them out with final flags, error handling, and examples.

### Pattern 1 — Start a Run

Detect the developer's current tmux session, mint a unique run ID, create a new window without stealing focus, wait for the fresh shell to be ready to receive input, record metadata, then launch the ralph command.

```bash
RUN_ID="drive-$(date +%s)-$$"          # PID suffix guarantees uniqueness within one second
SESSION=$(tmux display-message -p '#S')
WIN="ralph-$RUN_ID"
RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
CAPTURE_INDEX=0                         # initialized here; Pattern 2 increments it
mkdir -p "$RUN_DIR"

# -d = don't steal focus from the user's current window
tmux new-window -t "$SESSION" -n "$WIN" -d

# Wait for the new window's shell to be ready before sending any keys.
# This prevents keystrokes from landing mid-prompt-initialization.
wait_stable 5000 || true

PANE_SIZE=$(tmux display-message -t "$SESSION:$WIN" -p '#{pane_width}x#{pane_height}')
WIN_INDEX=$(tmux display-message -t "$SESSION:$WIN" -p '#I')
COMMAND="cd /path/to/project && ralph pipeline run foo.dot"
# If a real $COMMAND can contain literal '"' characters, escape them before
# embedding into the heredoc (sed 's/"/\\"/g'). The example command has none.

cat > "$RUN_DIR/meta.json" <<EOF
{
  "session": "$SESSION",
  "window": "$WIN",
  "window_index": "$WIN_INDEX",
  "run_id": "$RUN_ID",
  "pid": "$$",
  "pane_size": "$PANE_SIZE",
  "started": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "$COMMAND"
}
EOF

# Launch the command. Use -l for the text payload, then Enter as a separate call.
tmux send-keys -t "$SESSION:$WIN" -l "$COMMAND"
tmux send-keys -t "$SESSION:$WIN" Enter
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start window=$WIN" >> "$RUN_DIR/events.log"
```

### Pattern 2 — Capture

Increment the counter, write both text and ANSI-preserved archives, atomically swap the `current.*` files so concurrent readers always see a whole capture.

```bash
CAPTURE_INDEX=$((CAPTURE_INDEX + 1))
N=$(printf "%03d" "$CAPTURE_INDEX")

# ANSI-stripped archive, then atomic swap of current.txt
tmux capture-pane -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$N.txt"
cp "$RUN_DIR/capture-$N.txt" "$RUN_DIR/current.txt.tmp"
mv "$RUN_DIR/current.txt.tmp" "$RUN_DIR/current.txt"

# ANSI-preserved archive, then atomic swap of current.ansi
tmux capture-pane -e -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$N.ansi"
cp "$RUN_DIR/capture-$N.ansi" "$RUN_DIR/current.ansi.tmp"
mv "$RUN_DIR/current.ansi.tmp" "$RUN_DIR/current.ansi"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) capture $N" >> "$RUN_DIR/events.log"
```

### Pattern 3 — Wait for Stable UI (primary waiter)

Poll the pane, compare each capture to the previous one, declare stable when two consecutive captures are identical. Works for every Ink surface without knowing what is being rendered. The default timeout is 10 seconds with 200ms polls; elapsed time is measured by real wall clock, not by loop iteration count, because `capture-pane` can take longer than the nominal interval.

```bash
wait_stable() {
  local budget_ms=${1:-10000}
  local start_ns deadline_ns now_ns
  start_ns=$(date +%s%N)
  deadline_ns=$((start_ns + budget_ms * 1000000))
  # Sentinel that cannot appear in a capture (a control character).
  local prev=$'\x01'
  while : ; do
    now_ns=$(date +%s%N)
    if [ "$now_ns" -ge "$deadline_ns" ]; then
      local spent=$(( (now_ns - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable TIMEOUT elapsed=${spent}ms" >> "$RUN_DIR/events.log"
      return 1
    fi
    local now
    now=$(tmux capture-pane -p -t "$SESSION:$WIN")
    if [ "$prev" != $'\x01' ] && [ "$prev" = "$now" ]; then
      local spent=$(( ($(date +%s%N) - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable elapsed=${spent}ms" >> "$RUN_DIR/events.log"
      return 0
    fi
    prev="$now"
    sleep 0.2
  done
}
```

Notes:

- The `$'\x01'` sentinel is a control byte that `tmux capture-pane` never emits (it strips control characters by default). Distinct from the empty string, so an empty pane is treated as a valid state that can be "stable".
- Elapsed accounting uses `date +%s%N` (nanoseconds) both for deadline checks and for the log line, so the budget reflects wall-clock time.
- Note on macOS: stock BSD `date` does not support `%N`. The patterns document will fall back to `gdate` (from coreutils) if `date +%s%N` prints `N` literally; both alternatives are documented inline. If neither is available, the document uses `perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'` as a last resort. The implementation plan will confirm which path the developer's macOS has.

### Pattern 4 — Wait for a Precise State via Source Grep (rare, opt-in)

When "stable" is not enough (e.g., Claude needs to distinguish "overlay is ready for input" from "overlay is still opening its box"), Claude extracts the literal string the component currently renders using ripgrep, then waits for that string to appear in a pane capture. No hardcoded markers; the source of truth is the code.

```bash
# Example: find the current submit-hint string used by ChatUI.
# rg -o emits only the matched substring; we then strip the surrounding quotes.
HINT=$(rg -o '"[^"]*(Press|submit|↵)[^"]*"' src/cli/lib/ src/cli/commands/ \
        | head -1 \
        | sed 's/^"//; s/"$//')

wait_for_string() {
  local needle=$1
  local budget_ms=${2:-10000}
  local start_ns deadline_ns now_ns
  start_ns=$(date +%s%N)
  deadline_ns=$((start_ns + budget_ms * 1000000))
  while : ; do
    now_ns=$(date +%s%N)
    [ "$now_ns" -ge "$deadline_ns" ] && return 1
    if tmux capture-pane -p -t "$SESSION:$WIN" | grep -qF -- "$needle"; then
      return 0
    fi
    sleep 0.2
  done
}

wait_for_string "$HINT" 10000
```

Known limitations of the grep-based approach (documented alongside the helper):

- Only works for double-quoted string literals. Template literals (backticks) and JSX text nodes split across lines are not matched. When source uses those forms, Claude falls back to `wait_stable` and visual inspection of `current.txt`.
- The regex is deliberately narrow (matches only the first string containing the anchor words) to avoid greedy mis-extraction. False positives are possible if two unrelated strings share an anchor word; Claude verifies the extracted needle by eye before waiting on it.
- Source directories worth grepping: `src/cli/lib/output.ts` (shared Ink components), `src/cli/commands/` (command-specific overlays), `src/attractor/handlers/` (interactive handler prompts). `src/cli/mcp/` was removed from the original list because MCP server code does not render user-visible TUI strings.

### Pattern 5 — Send Input

Literal text payloads use `send-keys -l` to avoid shell-like parsing. Control keys use the explicit tmux names (`Enter`, `Escape`, `C-c`, `Tab`, `BSpace`). The discipline is: **always `wait_stable` before and after `send-keys`**, because tmux delivers the input instantly but Ink may not have a reader ready.

```bash
wait_stable || true
tmux send-keys -t "$SESSION:$WIN" -l "hello world"
tmux send-keys -t "$SESSION:$WIN" Enter
wait_stable || true
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) send-keys 'hello world' Enter" >> "$RUN_DIR/events.log"
```

Pattern 1's launch uses the same discipline (text via `-l`, then `Enter` as a separate call) so there is only one "how to send input" rule to remember.

A note on the race between the two `send-keys` calls: if a debugging session is interrupted between the text call and the `Enter` call, the pane has text entered with no newline — Ink sees a partial input line. This is logged in Gotcha 9 (below). Claude's mitigation is to always pair the two calls in the same shell command group so an interrupt is unlikely to split them.

### Pattern 6 — Cleanup

Normal completion updates `meta.json` *first*, then kills the window. Doing the JSON update first guarantees the run has an audit trail even if `kill-window` fails. The update is done with `sed` against a bash heredoc — no `jq` required.

```bash
ENDED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EXIT_REASON=${1:-clean}

# Insert "ended" and "exit_reason" before the closing brace.
# The closing brace is on its own line, so a single sed command suffices.
sed -i.bak -e "s|^}$|  ,\"ended\": \"$ENDED\",\n  \"exit_reason\": \"$EXIT_REASON\"\n}|" "$RUN_DIR/meta.json"
rm -f "$RUN_DIR/meta.json.bak"

echo "$ENDED cleanup exit_reason=$EXIT_REASON" >> "$RUN_DIR/events.log"
tmux kill-window -t "$SESSION:$WIN" 2>/dev/null || true
```

The implementation plan will verify the `sed` incantation on macOS (BSD sed requires `-i.bak` with an explicit backup extension) and will validate the resulting JSON by running `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$RUN_DIR/meta.json"` — ralph already ships Node, so this adds no dependency. If either the `sed` incantation or the JSON parse fails on the developer's macOS, the implementation plan must select a replacement strategy (pure-bash rewrite) before the patterns document is committed. No python fallback is documented here; if a future fallback becomes necessary it gets its own design revision.

### Recovery from Orphaned Runs

A run is **orphaned** when its `meta.json` has no `ended` field (the cleanup pattern was not reached). At session start, Claude lists orphans and offers to kill their windows.

```bash
recover_orphans() {
  local found=0
  local orphan_dirs=()
  for dir in "$HOME/.ralph/harness"/drive-*/; do
    [ -d "$dir" ] || continue
    if ! grep -q '"ended"' "$dir/meta.json" 2>/dev/null; then
      found=$((found + 1))
      orphan_dirs+=("$dir")
      local win
      # Match "window" but not "window_index": require the closing quote to be followed by a colon
      # and nothing else between the opening " and the value.
      win=$(grep -o '"window"[[:space:]]*:[[:space:]]*"[^"]*"' "$dir/meta.json" \
             | head -1 \
             | sed 's/.*"\([^"]*\)"$/\1/')
      echo "orphan: $dir window=$win"
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "no orphans"
    return 0
  fi

  # Kill orphan windows. tmux list-windows -F '#S:#W' emits "session:window" with no
  # leading space, so the grep pattern must not require one.
  echo "To kill all orphan windows:"
  echo "  tmux list-windows -a -F '#S:#W' | grep ':ralph-drive-' | xargs -n1 tmux kill-window -t"

  # Prune orphan scratch dirs. The inline shell wrapper is required so the orphan
  # test is actually consulted; a naive 'find -exec grep -L \; -exec rm +' chain
  # always runs the rm, because -exec returns the command's exit status (which for
  # grep -L is always success when the file exists).
  echo "To prune orphan scratch dirs:"
  echo "  find ~/.ralph/harness -maxdepth 1 -type d -name 'drive-*' \\"
  echo "    -exec sh -c 'grep -q \"\\\"ended\\\"\" \"\$1/meta.json\" 2>/dev/null || rm -rf \"\$1\"' _ {} \\;"
}
```

The recovery snippet is listed rather than auto-run — Claude reviews the orphan list before deciding whether to issue the kill or prune commands. Smoke Test 3 (below) exercises the full flow end to end.

A note on snippet load order: the `wait_stable` function is defined in Pattern 3 but Pattern 1 calls it. In the patterns document, all six patterns will be presented as sections of a single sourceable shell script (`docs/harness/tmux-drive.sh.md` or inlined in `tmux-drive.md` as one copy-paste block), so `wait_stable` is defined before any pattern that uses it. Claude does not copy individual patterns in isolation.

### Visual Capture (opt-in)

Screenshots are produced by briefly switching the developer's view to the harness window, running `screencapture`, and switching back. The flow records the previously-active window index so the switch is invisible except for a brief flash.

```bash
# Abort if the frontmost app is not a terminal emulator — we would capture the wrong window.
FRONT=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true')
case "$FRONT" in
  Terminal|iTerm2|Ghostty|kitty|WezTerm|Alacritty) ;;
  *) echo "screenshot aborted: frontmost app is '$FRONT', not a known terminal" >&2; return 1 ;;
esac

CURRENT=$(tmux display-message -p '#I')
tmux select-window -t "$SESSION:$WIN"
sleep 0.3  # let the terminal emulator redraw the newly-selected window
screencapture -x "$RUN_DIR/capture-$(printf %03d "$CAPTURE_INDEX").png"
tmux select-window -t "$SESSION:$CURRENT"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) screenshot $CAPTURE_INDEX" >> "$RUN_DIR/events.log"
```

Notes:

- `-x` suppresses the shutter sound. `-o` was removed from the earlier draft because it only affects window shadows with `-w`, which is not used here.
- The flow captures the entire screen, not just the tmux pane. Cropping is not attempted — Claude can identify the tmux content visually, and computing pane pixel bounds is out of scope.
- During the ~1 second between `select-window`s, the developer's view is briefly pinned to the harness window. If the developer switches windows manually in that interval, the final `select-window -t "$SESSION:$CURRENT"` lands them where they were at the *start* of the helper, not where they are *now*. This is acceptable because visual captures are rare and the operation is clearly attributable.

## Gotchas (Known Limitations)

These will appear as a dedicated section in the patterns document so Claude does not re-discover them.

1. **Screenshots require terminal focus.** `screencapture` captures whatever is currently on screen. The helper checks `frontApp` via AppleScript and aborts if it is not a known terminal emulator. Even then, the capture reflects the current view, not the "harness window in isolation."
2. **Pane size drifts after start.** `meta.json.pane_size` records the geometry at the moment the new window was created. If the developer later resizes the terminal or attaches another client at a different size, the recorded value becomes stale. Treat it as "the size ralph initially saw", not "the current size". Claude can re-read the live size any time via `tmux display-message -t "$SESSION:$WIN" -p '#{pane_width}x#{pane_height}'`.
3. **`current.txt` is racy with in-flight renders.** A one-shot capture called mid-render shows a half-drawn frame. Rule: always go through `wait_stable` before treating `current.txt` as authoritative. Atomic rename on write protects against *torn reads* of a single file but does nothing for *rendering races* inside ralph itself. Also: `current.txt` and `current.ansi` are swapped independently — a reader that consumes both in one operation could briefly see a new `.txt` paired with a stale `.ansi`. This is intentional: the two files are analyzed independently, not as a matched pair.
4. **`send-keys` is instantaneous.** Ink may not have a reader ready at that moment. Always `wait_stable` before and after `send-keys`, and also `wait_stable` after `new-window -d` in Pattern 1 before sending the launch command — a fresh shell needs a moment to print its prompt.
5. **Long payloads need `-l`.** Spaces, quotes, and `$` are parsed by tmux unless `send-keys -l` is used. Control keys (`Enter`, `Escape`, etc.) must be sent as separate `send-keys` arguments. Pattern 1 and Pattern 5 both apply this rule.
6. **No auto-cleanup of scratchpad.** Runs accumulate under `~/.ralph/harness/`. The retention policy is *advisory*: Claude runs `find ~/.ralph/harness -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +` when the developer asks to prune, and the document shows the one-liner. No cron, no automatic deletion.
7. **Abort leaves orphaned windows.** If a debugging session crashes mid-run, the tmux window stays open and `meta.json` has no `ended` field. The `recover_orphans` snippet lists and offers to kill them. Claude reviews the list before issuing the kill.
8. **macOS only for screenshots.** The text-capture and send-input patterns are portable; the `screencapture` helper is not. Linux/other-platform support is explicitly out of scope.
9. **Two-call input race.** `send-keys -l "text"` followed by `send-keys Enter` is two tmux calls for one logical input. If Claude is interrupted between them (signal, parent-process crash), the pane holds text with no newline and Ink sees an incomplete input line. Mitigation: pair the two calls in the same shell command group so the interrupt window is small, and let `wait_stable` after the pair surface any stuck state.
10. **BSD date does not support `%N`.** Pattern 3 and Pattern 4 assume nanosecond precision from `date +%s%N`. Stock macOS `date` (BSD) prints `N` literally. The patterns document probes at session start: if `date +%s%N` yields a literal `N`, it falls back to `gdate` (coreutils) or `perl -MTime::HiRes=time`. The implementation plan will confirm which path is available on the developer's macOS and hard-code the working incantation.
11. **`meta.json` update via `sed` depends on the closing-brace format.** Pattern 6's `sed` incantation matches a literal `}` on its own line. If the heredoc that wrote `meta.json` in Pattern 1 is ever reformatted, the cleanup step silently does nothing. The smoke test exercises this end-to-end so regressions surface immediately.

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

No source code changes. No new npm dependencies. No new system dependencies beyond those listed in Prerequisites (tmux, macOS coreutils, ripgrep, macOS screencapture). No MCP server. No binary files other than screenshots produced at runtime.

## Testing Strategy

Because the deliverable is documentation + filesystem conventions, testing is manual and lightweight:

1. **Smoke test 1 — round trip a trivial command.** Follow the patterns document to launch `ralph --help` in a new harness window, capture, verify `current.txt` contains expected text, clean up. Confirms patterns 1, 2, 3, 6 work.
2. **Smoke test 2 — interactive pipeline.** Launch `ralph pipeline run <dot-with-wait-human>`, wait stable, send a decision label, wait stable, verify the pipeline advances. Confirms patterns 4, 5 work against the real ChatUI overlay.
3. **Smoke test 3 — orphan recovery.** Intentionally kill a harness mid-run, then run the recovery snippet and verify the orphan window is surfaced and killable.
4. **Smoke test 4 — visual capture.** Run the screenshot helper, verify a non-empty PNG lands at the expected path, verify `events.log` records the screenshot event, verify the developer's active window is restored.

Each smoke test is a sequence of Bash commands from the patterns document. If a smoke test requires workarounds beyond what the document specifies, the document is wrong and must be fixed before the test is considered passing.

## Success Criteria

- Claude, starting a fresh session with no preloaded memory about this harness, can find the patterns document via exactly two tool calls: one `Grep` of `CLAUDE.md` for the keyword "harness", and one `Read` of the resulting path.
- Following only the document, Claude can drive a pipeline run, interact with its overlay, and produce captures for analysis — without reading any ralph-cli source code to figure out how tmux works.
- The developer's existing tmux windows are never touched. The only visible artifact of a harness run is the brief window-switch during a visual capture, if one is requested.
- A week later, after Ink components have been renamed or refactored, the harness still works because pattern 4 grabs strings from the source at runtime rather than from a stale catalog.

## Open Questions

None. All previously-raised ambiguities (session scope, interaction interface, observation scope, synchronization strategy, visual capture approach, scratchpad location, and catalog rot) were resolved during brainstorming.
