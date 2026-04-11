# Tmux Drive Harness — Patterns

Read this document at the start of any debugging session that needs to observe ralph's Ink TUI. All six patterns below are presented as sections of a single sourceable bash block. Copy the whole block into your shell before calling any pattern individually.

## When to use this

Use this harness when debugging ralph's Ink TUI — pipeline display, ChatUI overlay, meditate session, implement loop output, run-scenarios progress — and you need to *observe* what the UI actually does (not what the code says it should do).

Not for:

- **Automated regression tests.** See `src/cli/tests/scenarios/` and the existing `run-scenarios` command.
- **User-facing demos.** This is a dev-time debugging tool.
- **Driving commands that do not spawn a TUI.** For non-TUI commands, just run them in your current shell.

## Prerequisites

- **tmux** (any 3.x version).
- **macOS** (the `screenshot` helper is mac-specific; text patterns are portable but not validated elsewhere).
- **ripgrep** (`rg`) for Pattern 4 source grep.
- **Node** (already a ralph dependency) for validating `meta.json` in smoke tests.

No jq, no Python, no npm packages.

## Setup: source the patterns block

Copy the entire fenced block below into your current shell. It defines every helper function used by the patterns that follow. Nothing is executed by sourcing — you still need to call the individual helpers.

```bash
# ---------- tmux drive harness helpers ----------
# Source this block before using any pattern.

# Globals filled in by Pattern 1 (start_run). Every other helper reads them.
: "${SESSION:=}"
: "${WIN:=}"
: "${RUN_DIR:=}"
: "${RUN_ID:=}"
: "${CAPTURE_INDEX:=0}"

# Time source — resolved at source time based on what the probe found.
# Pattern 3 and Pattern 4 call now_ns() for deadline math.
now_ns() {
  perl -MTime::HiRes=time -e 'printf "%d", time()*1000000000'
}

# ---------- Pattern 3: wait_stable ----------
wait_stable() {
  local budget_ms=${1:-10000}
  local start_ns deadline_ns t
  start_ns=$(now_ns)
  deadline_ns=$((start_ns + budget_ms * 1000000))
  local prev=$'\x01'   # control-byte sentinel; tmux capture-pane never emits it
  while : ; do
    t=$(now_ns)
    if [ "$t" -ge "$deadline_ns" ]; then
      local spent=$(( (t - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable TIMEOUT elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 1
    fi
    local now
    now=$(tmux capture-pane -p -t "$SESSION:$WIN")
    if [ "$prev" != $'\x01' ] && [ "$prev" = "$now" ]; then
      local spent=$(( ($(now_ns) - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 0
    fi
    prev="$now"
    sleep 0.2
  done
}

# ---------- Pattern 1: start_run ----------
# Usage: start_run "<command to run in the new window>"
# Side effects: sets SESSION, WIN, RUN_DIR, RUN_ID, CAPTURE_INDEX; creates the
# scratchpad directory; creates a new tmux window in the current session; writes
# meta.json; launches the command.
start_run() {
  local cmd=$1
  if [ -z "$cmd" ]; then
    echo "start_run: command is required" >&2
    return 2
  fi

  RUN_ID="drive-$(date +%s)-$$"
  SESSION=$(tmux display-message -p '#S')
  WIN="ralph-$RUN_ID"
  RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
  CAPTURE_INDEX=0
  mkdir -p "$RUN_DIR"

  # -d = don't steal focus
  tmux new-window -t "$SESSION" -n "$WIN" -d

  # Wait for the fresh shell to finish printing its prompt.
  wait_stable 5000 || true

  local pane_size win_index
  pane_size=$(tmux display-message -t "$SESSION:$WIN" -p '#{pane_width}x#{pane_height}')
  win_index=$(tmux display-message -t "$SESSION:$WIN" -p '#I')

  # Escape embedded double quotes in $cmd so meta.json stays valid JSON.
  local cmd_json
  cmd_json=$(printf '%s' "$cmd" | sed 's/"/\\"/g')

  cat > "$RUN_DIR/meta.json" <<EOF
{
  "session": "$SESSION",
  "window": "$WIN",
  "window_index": "$win_index",
  "run_id": "$RUN_ID",
  "pid": "$$",
  "pane_size": "$pane_size",
  "started": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "$cmd_json"
}
EOF

  # Launch: text via -l, then Enter as a separate call.
  tmux send-keys -t "$SESSION:$WIN" -l "$cmd"
  tmux send-keys -t "$SESSION:$WIN" Enter

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start window=$WIN" >> "$RUN_DIR/events.log"
}

# ---------- Pattern 2: capture ----------
# Writes both ANSI-stripped and ANSI-preserved versions. Atomically swaps the
# current.txt / current.ansi pointers via rename.
capture() {
  CAPTURE_INDEX=$((CAPTURE_INDEX + 1))
  local n
  n=$(printf "%03d" "$CAPTURE_INDEX")

  # ANSI-stripped
  tmux capture-pane -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$n.txt"
  cp "$RUN_DIR/capture-$n.txt" "$RUN_DIR/current.txt.tmp"
  mv "$RUN_DIR/current.txt.tmp" "$RUN_DIR/current.txt"

  # ANSI-preserved
  tmux capture-pane -e -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$n.ansi"
  cp "$RUN_DIR/capture-$n.ansi" "$RUN_DIR/current.ansi.tmp"
  mv "$RUN_DIR/current.ansi.tmp" "$RUN_DIR/current.ansi"

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) capture $n" >> "$RUN_DIR/events.log"
}

# ---------- Pattern 4: wait_for_string ----------
# Polls the pane until a literal substring appears, or the budget expires.
# Use when wait_stable is not precise enough (e.g., distinguishing
# "overlay is waiting for input" from "overlay is still opening").
wait_for_string() {
  local needle=$1
  local budget_ms=${2:-10000}
  if [ -z "$needle" ]; then
    echo "wait_for_string: needle is required" >&2
    return 2
  fi
  local start_ns deadline_ns t
  start_ns=$(now_ns)
  deadline_ns=$((start_ns + budget_ms * 1000000))
  while : ; do
    t=$(now_ns)
    if [ "$t" -ge "$deadline_ns" ]; then
      local spent=$(( (t - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-for-string TIMEOUT needle=\"$needle\" elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 1
    fi
    if tmux capture-pane -p -t "$SESSION:$WIN" | grep -qF -- "$needle"; then
      local spent=$(( ($(now_ns) - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-for-string MATCH needle=\"$needle\" elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 0
    fi
    sleep 0.2
  done
}

# ---------- Pattern 5: send_input ----------
# Sends text followed by Enter. Always pair with wait_stable on both sides.
# Control keys (Escape, C-c, etc.) should be sent directly via tmux send-keys,
# not through this helper.
send_input() {
  local text=$1
  wait_stable 3000 || true
  tmux send-keys -t "$SESSION:$WIN" -l "$text"
  tmux send-keys -t "$SESSION:$WIN" Enter
  wait_stable 3000 || true
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) send-input \"$text\" Enter" >> "$RUN_DIR/events.log"
}

# For control keys and non-text sequences, use tmux send-keys directly:
#   tmux send-keys -t "$SESSION:$WIN" Escape
#   tmux send-keys -t "$SESSION:$WIN" C-c

# ---------- Pattern 6: cleanup_run ----------
# Updates meta.json FIRST (so the audit trail survives even if kill-window fails),
# then kills the window. Pure-bash rewrite — no sed, no jq, no portability traps.
cleanup_run() {
  local exit_reason=${1:-clean}
  local ended
  ended=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Rewrite meta.json line-by-line, inserting "ended" + "exit_reason" before the
  # closing brace. Pattern 1's heredoc always writes "}" on its own line, so a
  # literal string compare is enough.
  local tmp="$RUN_DIR/meta.json.tmp"
  : > "$tmp"
  while IFS= read -r line; do
    if [ "$line" = "}" ]; then
      printf '  ,"ended": "%s",\n  "exit_reason": "%s"\n}\n' "$ended" "$exit_reason" >> "$tmp"
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$RUN_DIR/meta.json"
  mv "$tmp" "$RUN_DIR/meta.json"

  echo "$ended cleanup exit_reason=$exit_reason" >> "$RUN_DIR/events.log"
  tmux kill-window -t "$SESSION:$WIN" 2>/dev/null || true
}

# ---------- Visual capture: screenshot ----------
# Briefly switches tmux to the harness window, screenshots the entire screen,
# then switches back. Requires the terminal emulator to be the frontmost app.
screenshot() {
  local front
  front=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)
  case "$front" in
    Terminal|iTerm2|Ghostty|kitty|WezTerm|Alacritty|"Terminal.app") ;;
    *)
      echo "screenshot aborted: frontmost app is '$front', not a known terminal" >&2
      return 1
      ;;
  esac

  local n current
  n=$(printf "%03d" "$CAPTURE_INDEX")
  current=$(tmux display-message -p '#I')

  tmux select-window -t "$SESSION:$WIN"
  sleep 0.3   # let the terminal emulator redraw
  screencapture -x "$RUN_DIR/capture-$n.png"
  tmux select-window -t "$SESSION:$current"

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) screenshot $n" >> "$RUN_DIR/events.log"
}

# ---------- Recovery: recover_orphans ----------
# A run is orphaned when meta.json has no "ended" field. Lists orphans and
# prints the recipes for killing stale windows / pruning stale scratch dirs.
# Never kills or deletes automatically.
recover_orphans() {
  local found=0
  local dir
  for dir in "$HOME/.ralph/harness"/drive-*/; do
    [ -d "$dir" ] || continue
    if ! grep -q '"ended"' "$dir/meta.json" 2>/dev/null; then
      found=$((found + 1))
      local win
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

  echo ""
  echo "To kill all orphan windows:"
  echo "  tmux list-windows -a -F '#S:#W' | grep ':ralph-drive-' | xargs -n1 tmux kill-window -t"
  echo ""
  echo "To prune orphan scratch dirs:"
  echo "  find ~/.ralph/harness -maxdepth 1 -type d -name 'drive-*' \\"
  echo "    -exec sh -c 'grep -q \"\\\"ended\\\"\" \"\$1/meta.json\" 2>/dev/null || rm -rf \"\$1\"' _ {} \\;"
}

# ---------- end helpers ----------
```

## Pattern 1 — Start a run

`start_run "<cmd>"` creates a new tmux window in your current session (without stealing focus), waits for the shell to print its prompt, records run metadata, and launches the command.

After it returns, these globals are set and are used implicitly by every other pattern:

- `RUN_ID` — `drive-<unix-seconds>-<pid>`, unique even when two runs start in the same second.
- `SESSION` — the tmux session you were attached to.
- `WIN` — the new window's name, `ralph-<run-id>`.
- `RUN_DIR` — `~/.ralph/harness/<run-id>/`, the scratchpad for this run.
- `CAPTURE_INDEX` — starts at `0`; Pattern 2 increments it.

`meta.json` is written once here. Pattern 6 appends `ended` and `exit_reason` before kill. Embedded `"` characters in the command are escaped with `sed` so the JSON stays valid.

## Pattern 2 — Capture

`capture` writes the current pane contents to two archive files and atomically updates the `current.*` pointers. Default analysis uses `current.txt` (ANSI-stripped, clean through the Read tool). `current.ansi` is the escalation path when colors or cursor state matter.

After calling `capture`, read `current.txt` — that is the authoritative snapshot. The numbered archive files (`capture-001.txt`, `capture-002.txt`, ...) support retrospective diffs: `diff capture-005.txt capture-006.txt` shows exactly what changed between two stable states.

Both `current.txt` and `current.ansi` are overwritten atomically via `mv` (POSIX rename is atomic within a filesystem), so a concurrent reader cannot see a half-written file. The two files are swapped independently; a consumer that reads *both* in one operation could briefly see a new `.txt` paired with a stale `.ansi`. This is intentional — analyze them independently, not as a matched pair.

Always call `wait_stable` before `capture` unless you are intentionally catching a mid-render frame.

## Pattern 3 — Wait for stable UI

`wait_stable` is the default synchronization primitive. It polls `tmux capture-pane` every 200ms and returns 0 as soon as two consecutive captures match. Works for every Ink surface without knowing what is being rendered.

Call it:
- Before the first capture after `start_run`, to let the new window's shell print its prompt.
- Before and after every `send_input` call, to let Ink absorb the input.
- Whenever you need to treat `current.txt` as authoritative.

Failure mode: if the UI keeps changing past `budget_ms` (default 10000), it returns 1 and logs `wait-stable TIMEOUT` to `events.log`. The timeout is measured by wall clock via `now_ns()`, so heavy `capture-pane` calls do not inflate the budget.

Gotcha: the control-byte sentinel `$'\x01'` lets an empty pane be "stable" (a genuinely empty capture is distinct from the pre-loop sentinel). Without it, `wait_stable` would hang on any pane that captures to an empty string.

## Pattern 4 — Wait for a precise state (source grep)

When `wait_stable` is too coarse — e.g., you need to distinguish "the overlay is waiting for your input" from "the overlay is still opening its box" — extract the literal string the component renders by grepping the source, then wait for it.

Example: find the current ChatUI submit hint by its anchor words and wait for it.

```bash
HINT=$(rg -o '"[^"]*(Press|submit|↵)[^"]*"' src/cli/lib/ src/cli/commands/ | head -1 | sed 's/^"//;s/"$//')
wait_for_string "$HINT" 10000
```

Source directories worth grepping:

- `src/cli/lib/output.ts` — shared Ink components
- `src/cli/commands/` — command-specific overlays
- `src/attractor/handlers/` — interactive handler prompts

Known limitations:

- **Only matches double-quoted string literals.** Template literals (backticks) and JSX text nodes split across lines are not found. Fall back to `wait_stable` + visual inspection of `current.txt` in those cases.
- **False positives possible** when two unrelated strings share an anchor word. Verify the extracted needle by eye (`echo "$HINT"`) before waiting on it.
- **`src/cli/mcp/` is not in the grep list** — MCP server code does not render user-visible TUI strings.

## Pattern 5 — Send input

`send_input "<text>"` sends a literal string followed by Enter. It calls `wait_stable` before and after, so the UI has a chance to absorb the input and render the response.

For control keys, use `tmux send-keys` directly:

```bash
tmux send-keys -t "$SESSION:$WIN" Escape
tmux send-keys -t "$SESSION:$WIN" C-c
```

Gotcha: `send_input` is two `tmux send-keys` calls (text, then Enter). If you are interrupted between them, the pane holds text with no newline. Mitigation: keep `send_input` calls in a single shell command group so the interrupt window is tiny, and let the trailing `wait_stable` surface any stuck state.

## Pattern 6 — Cleanup

`cleanup_run [exit_reason]` finalizes a run. It updates `meta.json` with `ended` + `exit_reason`, logs the cleanup event, then kills the tmux window.

The `meta.json` update happens *before* `kill-window` so the audit trail survives even if the kill fails. `exit_reason` defaults to `clean`; pass `aborted` or `orphaned` when appropriate.

After cleanup, the scratchpad at `$RUN_DIR` stays on disk for post-mortem analysis. Prune manually — see "Pruning the scratchpad" below.

## Visual capture (opt-in)

`screenshot` briefly switches your tmux view to the harness window, captures the whole screen via macOS `screencapture`, then switches back. The PNG lands in `$RUN_DIR/capture-<NNN>.png` with the same index as the most recent `capture` call.

**Opt-in, not default.** Screenshots are disruptive (they flash your view). Call `screenshot` only when text capture is insufficient — e.g., to verify Ink box alignment, color bleed, or cursor placement that strips out of `current.txt`.

**Requires terminal focus.** The helper aborts with a clear message if the frontmost macOS app is not a known terminal emulator. If you are in another app when you call `screenshot`, `screencapture` would grab the wrong window.

**Captures the whole screen.** Cropping to the tmux pane is out of scope — Claude can identify the tmux content visually. Computing pane pixel bounds requires additional AppleScript and is explicitly deferred.

## Recovery from orphaned runs

A run is **orphaned** when its `meta.json` has no `ended` field (i.e., `cleanup_run` was never reached — a crash, Ctrl-C, or terminal close). At the start of any new session, call `recover_orphans` to list stale runs:

```bash
recover_orphans
```

Output looks like:

```
orphan: /Users/you/.ralph/harness/drive-1712950000-38291/ window=ralph-drive-1712950000-38291
orphan: /Users/you/.ralph/harness/drive-1712950123-40104/ window=ralph-drive-1712950123-40104

To kill all orphan windows:
  tmux list-windows -a -F '#S:#W' | grep ':ralph-drive-' | xargs -n1 tmux kill-window -t

To prune orphan scratch dirs:
  find ~/.ralph/harness -maxdepth 1 -type d -name 'drive-*' \
    -exec sh -c 'grep -q "\"ended\"" "$1/meta.json" 2>/dev/null || rm -rf "$1"' _ {} \;
```

`recover_orphans` prints recipes but never runs them. Review the orphan list, then run the kill/prune commands manually.

Note on the prune one-liner: the inline `sh -c` wrapper is *required*. A naive `find -exec grep -L \; -exec rm +` chain would delete every run (including finished ones), because `-exec` returns the command's exit status and `grep -L` always succeeds when the target file exists.

## Pruning the scratchpad

Runs accumulate under `~/.ralph/harness/`. The harness never auto-deletes them. Prune manually:

```bash
# Delete runs older than 7 days
find ~/.ralph/harness -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +

# Or delete everything that is definitely orphaned (no "ended" field)
find ~/.ralph/harness -maxdepth 1 -type d -name 'drive-*' \
  -exec sh -c 'grep -q "\"ended\"" "$1/meta.json" 2>/dev/null || rm -rf "$1"' _ {} \;
```

7 days is a suggestion, not a policy. Claude runs these when the developer asks.

## Gotchas

1. **Screenshots require terminal focus.** `screencapture` captures whatever is currently on screen. `screenshot` aborts if the frontmost app is not a known terminal, but even then the capture reflects the current view, not "the harness window in isolation."
2. **Pane size drifts after start.** `meta.json.pane_size` is the size at window creation. Re-read live via `tmux display-message -t "$SESSION:$WIN" -p '#{pane_width}x#{pane_height}'` when geometry matters.
3. **`current.txt` is racy with in-flight renders.** Atomic rename on write protects against torn reads of a single file but does nothing for rendering races inside ralph. Always `wait_stable` before treating `current.txt` as authoritative. `current.txt` and `current.ansi` are swapped independently — do not read them as a matched pair.
4. **`send-keys` is instantaneous.** Ink may not have a reader ready at that moment. Always `wait_stable` before and after `send_input`, and also after `new-window -d` in Pattern 1 before sending the launch command.
5. **Long payloads need `-l`.** Spaces, quotes, and `$` are parsed by tmux unless `send-keys -l` is used. Control keys must be sent as separate `send-keys` arguments.
6. **No auto-cleanup of scratchpad.** See "Pruning the scratchpad".
7. **Abort leaves orphaned windows.** Run `recover_orphans` at session start to list them.
8. **macOS-only for screenshots.** Text patterns are portable; the screenshot helper is not.
9. **Two-call input race.** `send_input` is two tmux calls (text, then Enter). An interrupt between them leaves the pane with text but no newline. Mitigation: keep `send_input` within a single shell command group and let the trailing `wait_stable` surface stuck state.
10. **BSD `date` does not support `%N`.** `now_ns` in the sourceable block uses perl `Time::HiRes` as determined by the environment probe. If you move to a machine without perl, re-run the probe.
11. **`cleanup_run`'s rewrite depends on the closing-brace format.** The heredoc in Pattern 1 always writes `}` on its own line, and `cleanup_run` does a literal `[ "$line" = "}" ]` compare. If that format ever changes, `cleanup_run` silently does nothing. The smoke tests exercise this end-to-end.
