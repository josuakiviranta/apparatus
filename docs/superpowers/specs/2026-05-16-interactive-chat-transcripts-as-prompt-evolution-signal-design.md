# Design: `/edit-instructions` — in-band editing of an interactive agent's `.md`

**Date:** 2026-05-16
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-15T1600-interactive-chat-transcripts-as-prompt-evolution-signal.md`
**Related ADRs:** ADR-0011 (skill-as-shim + live reference), ADR-0014 (interaction-drivers)
**Related illumination:** `.apparat/meditations/illuminations/2026-05-14T2005-interactive-chat-agents-lack-orientation-phase.md` — complementary, not competing

## 1. Motivation

Interactive chat nodes ship system prompts that live in `.md` files the user never sees during the session. When the agent does the wrong thing — forgets to read source first, answers too tersely, skips the orientation step — the user types a compensating prompt to patch it for that one turn. The next session resets to the same blank slate and the same compensating prompt fires again. This is the project's stated anti-pattern: README:225 commits to making agent policy "tweakable per pipeline (e.g. ...by editing the `.md`, not TypeScript)" — but only out-of-band, between runs, in a separate editor.

The original illumination proposed mining `digest.json` transcripts across runs to detect recurring asks and surface them via a learner node. The chat-summarizer refinement (Round 1) narrowed scope: the pain point is real, but the user already knows what they're re-explaining — they don't need ML clustering to discover it. They need a way to **persist the change without leaving the conversation**. The reduced surface is a single in-band slash command driven by skill instructions, plus the engine injection that makes self-modification possible at all.

### What this design closes

- The "I keep telling this agent to read source first every session" loop, replaced by one in-band edit.
- The discoverability gap: the system prompt is invisible; the slash command surfaces it on demand.
- The orientation gap for agent self-knowledge: NODE_ID + PIPELINE_NAME + AGENT_FILE_PATH let any interactive agent reason about which file it lives in and which pipeline node it represents.

### What this design explicitly does **not** close

- Cross-session transcript mining / ML clustering / frequency thresholds — dropped per refinement Round 1 ("scope is narrower than original illumination").
- A formal gate node (`chat-prompt-update-gate`) — dropped per refinement Round 1 ("user reply IS the gate"). The conversation itself is the confirmation surface.
- Discovery of recurring asks the user hasn't noticed — out of scope. The trigger is the user typing `/edit-instructions`, not the agent volunteering changes.
- Edits to bundled pipelines under `src/cli/pipelines/`. `AGENT_FILE_PATH` is the user-project copy at `.apparat/pipelines/<name>/<agent>.md`; bundled templates are read-only by convention.

## 2. Decision summary

Three additive surfaces — none breaking, none requiring schema migration:

1. **Engine injection.** Extend `SYSTEM_INJECTED_VARS` at `src/attractor/handlers/agent-prep.ts:16-19` to include `NODE_ID`, `PIPELINE_NAME`, `AGENT_FILE_PATH` alongside `ILLUMINATION_SERVER_PATH` and `PROJECT_ROOT`. `buildSystemInjectedVars` (line 21) grows two params (node id, pipeline dir, agent file path) and the call site at line 88 threads them. Agents opt in via `inputs:` frontmatter — the same mechanism `PROJECT_ROOT` uses today (proof: `agent-prep.ts:97` reads `config.inputs` and `inputs-renderer.ts:17` resolves each declared name).

2. **Slash command + footer hint.** Extend `SlashCommand` at `src/cli/lib/slash-commands.ts:1-6` with `{ kind: "edit-instructions" }`, extend `parseSlashCommand` (line 8) and `HELP_TEXT` (line 18). Update the footer hint at `src/cli/lib/interactions/drivers/agent.tsx:45` from `/end /abort /help · Esc to abort` to include `/edit-instructions`. The PipelineRunView dispatcher (per ADR-0014 §"Consequences") that already handles `/end /abort /help` inline gains one branch: on `edit-instructions`, inject a synthetic user message into the running chat session instructing the agent to follow the apparatus skill flow.

3. **Apparatus-owned skill + tool allowlist.** Add a new skill folder at `src/cli/skills/apparatus/edit-instructions/` containing `SKILL.md` whose body prescribes the seven-step flow (show body → ask intent → propose diff → reason about impact citing NODE_ID/PIPELINE_NAME → wait for explicit yes → call Edit on AGENT_FILE_PATH). Bundle it via the same path that ships `src/cli/skills/apparatus/SKILL.md` today (ADR-0011 shim pattern). Add `Edit` to the interactive agent's `tools` allowlist — the nuance the verifier called out: `src/cli/lib/agent.ts:123` declares `tools: []` as the default, so even with `dangerouslySkipPermissions` (line 122) the chat agent currently cannot call Edit. One-line addition in `interactive-agent-handler.ts`'s config assembly.

The chat-summarizer's flow contract is honored verbatim: user → `/edit-instructions` → agent shows current `.md` body → asks intent → proposes diff + impact reasoning → user replies yes/no/revise → on yes, agent calls Edit. No engine-side state machine. The skill's instructions are the only guardrail; the user's "yes" is the gate.

## 3. Architecture

### 3.1 Engine injection — three new system variables

`SYSTEM_INJECTED_VARS` today (verifier-quoted, `agent-prep.ts:16-19`):

```ts
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
] as const;
```

After:

```ts
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
  "NODE_ID",
  "PIPELINE_NAME",
  "AGENT_FILE_PATH",
] as const;
```

`buildSystemInjectedVars` today is `(projectRoot: string) => Record<...>` (line 21). It grows two params:

```ts
function buildSystemInjectedVars(
  projectRoot: string,
  nodeId: string,
  pipelineDir: string,
  agentName: string,
): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
    NODE_ID: nodeId,
    PIPELINE_NAME: path.basename(pipelineDir),
    AGENT_FILE_PATH: path.join(pipelineDir, `${agentName}.md`),
  };
}
```

`PIPELINE_NAME` derivation matches `agent-loader.ts:35` which resolves the agent path as `join(pipelineDir, ${name}.md)` — same `pipelineDir`, same joining, so the two are guaranteed-consistent. `pipelineDir` reaches the call site as `meta.dotDir` (`agent-prep.ts:70` `load(agentName, meta.dotDir)`); the call site at line 88 becomes:

```ts
const agentVariables: Record<string, unknown> = {
  ...buildSystemInjectedVars(meta.projectDir ?? cwd, node.id, meta.dotDir, agentName),
  ...ctx.values,
};
```

`node.id` is already in scope (used at `agent-prep.ts:94` for `nodeDir`). `meta.dotDir` is required (`registry.ts:36`) — no null guard needed.

`SYSTEM_VARS` at `src/attractor/core/validators/context.ts:8` is `new Set(SYSTEM_INJECTED_VARS)` and updates transitively without code change. The validator rule `bare_input_not_in_caller_inputs_or_system` (referenced in `inputs-refs.ts`) consults `SYSTEM_VARS` directly; the three new keys become valid `inputs:` targets automatically.

Renderer side: `inputs-renderer.ts:17-19` already looks each declared input up in `ctx.values`. The injected keys flow through `agentVariables` (which `assembleAgentPrompt` passes into `Agent` config), and from there into `ctx.values` per the merge at line 88. An agent that declares `inputs: [AGENT_FILE_PATH]` gets a rendered block:

```
## Inputs

<AGENT_FILE_PATH>/abs/path/to/.apparat/pipelines/illumination-to-implementation/chat_session.md</AGENT_FILE_PATH>
```

### 3.2 Slash command — `/edit-instructions`

Today (`slash-commands.ts:1-6`):

```ts
export type SlashCommand =
  | { kind: "end" }
  | { kind: "abort" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string }
  | { kind: "message"; text: string };
```

After: add one variant:

```ts
  | { kind: "edit-instructions" }
```

`parseSlashCommand` (line 8) gains one branch:

```ts
if (cmd === "edit-instructions") return { kind: "edit-instructions" };
```

`HELP_TEXT` (line 18) gains one row:

```
  /edit-instructions  Open a guided flow to revise this agent's system
                      prompt. The agent shows you the current body, asks
                      what to change, proposes a diff, and writes it on
                      your explicit confirmation.
```

### 3.3 Dispatcher — wiring `/edit-instructions` into the running session

Per ADR-0014's "Consequences" note: `/end /abort /help` are dispatched inline in `PipelineRunView` today (the planned tightening into the agent driver is a deferred follow-up). The new `edit-instructions` branch sits alongside them. On match, it injects a synthetic user message into the running chat session — the same channel the agent receives every other user turn through. The message body is a fixed string:

```
The user invoked /edit-instructions. Follow the apparatus
edit-instructions skill exactly: (1) print the current contents of
$AGENT_FILE_PATH, (2) ask what to change, (3) propose a unified diff,
(4) reason about how the change will alter your behaviour given that
you are node "$NODE_ID" in pipeline "$PIPELINE_NAME", (5) wait for
explicit "yes" before calling Edit on $AGENT_FILE_PATH. Do not call
Edit until the user replies "yes".
```

This is the simplest possible glue: the dispatcher does not parse the agent's `.md`, does not diff anything, does not own the confirmation state. All seven steps from the refinement bullet are executed by the agent itself, instructed by the bundled skill (§3.4). The dispatcher's only job is to surface the user's intent through the channel the agent already understands — natural language.

Placement: alongside the existing `/end /abort /help` handlers in `PipelineRunView` (per ADR-0014 §"Consequences", line 51 — "stays inline … for this landing"). When ADR-0014's deferred follow-up moves slash dispatch into the agent driver, `/edit-instructions` migrates with the others; no design change.

### 3.4 The skill — `src/cli/skills/apparatus/edit-instructions/SKILL.md`

The skill body encodes the seven-step flow as positive directives (per the user's "positive agent instructions" feedback memory):

1. Read `$AGENT_FILE_PATH` and print its body verbatim inside a triple-fence.
2. Ask: "What would you like to change?"
3. Compose a unified-diff string covering only the lines the user's intent touches; quote it.
4. State explicitly: "I am node `$NODE_ID` in pipeline `$PIPELINE_NAME`. This change will alter my behaviour in the following ways: …" — two to four sentences.
5. Ask: "Apply this change? Reply `yes` to write, `no` to cancel, or describe a revision."
6. On `yes`: call `Edit` on `$AGENT_FILE_PATH` with the diff applied. Confirm completion with the new path and a one-line summary.
7. On `no` or revision: discard the diff or repeat from step 3.

The skill explicitly requires `Edit` and is the only place that uses it; without it, `tools: ["Edit"]` would be a footgun. With it, the tool is gated on a written instruction.

Skill registration follows the existing `src/cli/skills/apparatus/` shape (sibling to `SKILL.md` and `pipelines.md`). Bundling: the `tsup` step that already copies `src/cli/skills/apparatus/SKILL.md` to `dist/skills/apparatus/SKILL.md` (per ADR-0011) generalises to copy the entire `src/cli/skills/apparatus/` tree, picking up `edit-instructions/SKILL.md` automatically.

### 3.5 Tool allowlist — adding `Edit` to the interactive agent

Verifier nuance, restated: `src/cli/lib/agent.ts:121-125`:

```ts
const DEFAULTS: Partial<AgentConfig> = {
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
};
```

`dangerouslySkipPermissions` waives the OS prompt, but `tools: []` still bars `Edit` from the allowlist passed to `claude --allowedTools` (`agent.ts:160-162`). Two options:

- **A. Add `Edit` to the interactive agent's per-call config** in `interactive-agent-handler.ts` before `assembleAgentPrompt` returns, by merging `{ tools: ["Edit", ...config.tools] }` into the loaded `AgentConfig`. Scoped to interactive nodes only. Looping / one-shot agents unchanged.
- **B. Let interactive agents declare `tools: [Edit]` in their own `.md` frontmatter** and require pipeline authors to opt in.

Pick **A**: the slash command is engine-wired and uniform, the skill assumes Edit is available; making it conditional on per-agent frontmatter spreads a contract across N agent files. Option A localises the rule in one place — the same handler that already owns interactive-specific config (`interactive-agent-handler.ts:25`). The change is one line in the config merge step.

The blast is bounded: only interactive agents (one handler in the engine) gain `Edit`. Looping / one-shot agents — every node typed `agent="..."` without `interactive=true` — retain `tools: []`.

### 3.6 Discoverability — the footer hint

`agent.tsx:45` today: `help: "/end /abort /help · Esc to abort"`.

After: `help: "/end /abort /help /edit-instructions · Esc to abort"`.

The driver keymap field renders as the bottom hint line whenever an interactive-agent block is live (per ADR-0014's `renderFooter` contract). One string edit, no logic change. This is the user-facing entry point — every other surface (skill, dispatcher, tool allowlist) is invisible until the user types the command.

## 4. Data flow

```
user types "/edit-instructions"
  → TextInput.onSubmit (agent.tsx:34)
  → PipelineRunView dispatcher matches kind: "edit-instructions"
  → injects synthetic user message into running chat session
       (instructs agent to follow apparatus edit-instructions skill)
  → agent reads $AGENT_FILE_PATH (already in its system prompt
       via inputs: declaration)
  → agent prints body, asks "what to change?"
user replies
  → agent proposes unified diff
  → agent reasons about behavioural impact, citing NODE_ID + PIPELINE_NAME
  → agent asks "apply? yes/no/revise"
user replies "yes"
  → agent calls Edit on $AGENT_FILE_PATH (tool allowlist permits;
       dangerouslySkipPermissions waives OS prompt)
  → file written to .apparat/pipelines/<name>/<agent>.md
  → ADR-0015's asymmetric GC (.apparat/runs/<runId>/ only) does not
       touch the agent file; next session loads the updated version
agent confirms with one-line summary
session continues
```

The current session's in-memory system prompt does **not** hot-reload. The edit takes effect on the **next** session of this node. This is acceptable per the chat-summarizer rationale: the user's frustration is "I re-explain this every session"; landing the change for the *next* session is the fix.

## 5. Code anchors

- `src/attractor/handlers/agent-prep.ts:16-19` — `SYSTEM_INJECTED_VARS` (extend by 3 keys).
- `src/attractor/handlers/agent-prep.ts:21-26` — `buildSystemInjectedVars` (extend signature + body).
- `src/attractor/handlers/agent-prep.ts:88` — call site (thread `node.id`, `meta.dotDir`, `agentName`).
- `src/attractor/handlers/agent-prep.ts:97` — `config.inputs as string[]` (opt-in seam — already exists, unchanged).
- `src/cli/lib/agent-loader.ts:35` — `join(pipelineDir, ${name}.md)` (confirms `AGENT_FILE_PATH` derivation matches loader's own path).
- `src/attractor/core/validators/context.ts:5-8` — `SYSTEM_VARS = new Set(SYSTEM_INJECTED_VARS)` (transitive update, no code change).
- `src/cli/lib/slash-commands.ts:1-6` — `SlashCommand` union (add variant).
- `src/cli/lib/slash-commands.ts:8-15` — `parseSlashCommand` (add branch).
- `src/cli/lib/slash-commands.ts:18-24` — `HELP_TEXT` (add row).
- `src/cli/lib/interactions/drivers/agent.tsx:45` — footer `help` string (one edit).
- `src/cli/lib/agent.ts:121-125` — `DEFAULTS.tools: []` (the nuance — bypassed by per-handler merge, defaults stay).
- `src/cli/lib/agent.ts:160-162` — `--allowedTools` flag construction (read path; no edit).
- `src/attractor/handlers/interactive-agent-handler.ts:26-29` — config assembly (add `Edit` to `tools`).
- `src/cli/skills/apparatus/SKILL.md` — existing skill (sibling reference for shape; not edited).
- `src/cli/skills/apparatus/edit-instructions/SKILL.md` — **new file** (the seven-step flow).
- `src/attractor/tests/graph-validator-inputs.test.ts` — add fixtures covering the new system-injected keys (they MUST NOT trigger `bare_input_not_in_caller_inputs_or_system`).
- `docs/adr/0014-interaction-drivers.md:50-53` — "stays inline … for this landing" (confirms dispatcher placement).
- `docs/adr/0011-skill-as-shim-plus-live-reference.md` — bundling pattern for the new skill.

## 6. Blast radius / impact surface

- **Size:** M.
- **Surfaces crossed:** engine (`src/attractor/handlers/`), CLI lib (`src/cli/lib/`), interaction driver (`src/cli/lib/interactions/drivers/`), skill content (`src/cli/skills/apparatus/`), tests + docs.
- **Breaking changes:** none. Both surfaces are purely additive.
  - `SYSTEM_INJECTED_VARS`: three new entries — pipelines/agents that don't declare them are unaffected.
  - `SlashCommand` union: one new variant — existing branches unchanged.
  - `HandlerExecutionContext` shape: unchanged.
  - `AgentConfig` shape: unchanged. `tools` default stays `[]`; the interactive handler's per-call merge is internal.
  - `.dot` schema, agent frontmatter schema, gate frontmatter schema: unchanged.
  - CLI flags, env vars: none added.
  - `digest.json` / `transcriptPath` shape: unchanged (this design does not read transcripts; the original illumination's reader is dropped per refinement).
- **Update checklist:**
  - [ ] `src/attractor/handlers/agent-prep.ts` — extend `SYSTEM_INJECTED_VARS`, `buildSystemInjectedVars` signature, and the single call site.
  - [ ] `src/attractor/handlers/interactive-agent-handler.ts` — merge `Edit` into `tools` for the interactive handler's per-call config.
  - [ ] `src/cli/lib/slash-commands.ts` — union variant + parser branch + HELP_TEXT row.
  - [ ] `src/cli/lib/interactions/drivers/agent.tsx` — footer hint string (one edit).
  - [ ] `src/cli/components/PipelineRunView.tsx` (or wherever `/end /abort /help` is dispatched per ADR-0014 §Consequences) — add `edit-instructions` branch that injects the synthetic user message.
  - [ ] `src/cli/skills/apparatus/edit-instructions/SKILL.md` — new file (the seven-step flow).
  - [ ] `tsup.config.ts` (or current bundler config) — confirm `src/cli/skills/apparatus/**` glob already picks up new subfolder; widen if not.
  - [ ] `src/attractor/tests/graph-validator-inputs.test.ts` — add cases asserting `inputs: [NODE_ID]` (and the other two new keys) does not trigger `bare_input_not_in_caller_inputs_or_system`.
  - [ ] `src/attractor/tests/agent-prep.test.ts` (or sibling) — assert `buildSystemInjectedVars` produces `NODE_ID`, `PIPELINE_NAME`, `AGENT_FILE_PATH`; assert `PIPELINE_NAME = basename(dotDir)` and `AGENT_FILE_PATH = join(dotDir, agentName + '.md')`.
  - [ ] `src/cli/tests/slash-commands.test.ts` (or new) — assert `parseSlashCommand("/edit-instructions")` yields `{ kind: "edit-instructions" }`.
  - [ ] `src/cli/skills/apparatus/pipelines.md` — append a short note in the "Inputs" or "Authoring" section that NODE_ID / PIPELINE_NAME / AGENT_FILE_PATH are available to any agent via `inputs:`.
  - [ ] `README.md` — add `/edit-instructions` to the command surface enumeration; cross-reference the README:225 "tweakable per pipeline" claim now that there is an in-band path.
  - [ ] `docs/adr/0019-edit-instructions-in-band.md` (optional, not blocking) — ADR pinning the in-band-Edit decision over the original learner-node proposal.

## 7. Open questions

- **Should the skill require the agent to git-diff `AGENT_FILE_PATH` against HEAD before editing**, so the user can see whether their change collides with uncommitted edits? Default: no; YAGNI for a single-machine personal-tool flow. Add if it bites.
- **Should `/edit-instructions` work in wait-human gate blocks too?** ADR-0014 §"Consequences" notes `wait-human` shares the gate driver. The slash command is dispatched from `PipelineRunView`, which is kind-agnostic — so it would technically fire. But gate prompts are static `.md` choices with no agent to instruct; the synthetic message would have nowhere to go. Defer: scope to `interactive-agent` blocks only; reject in the dispatcher for other kinds with a one-line message.
- **Hot-reload of the current session's system prompt after an Edit?** Out of scope. Next-session uptake is the contract. Refinement Round 1 ("nothing writes until explicit user confirmation") implicitly accepts the one-session lag; the user re-running the session is the verification.
- **Should the skill be required to commit the `.md` change after Edit?** Open. The agent file lives under `.apparat/pipelines/<name>/` which is tracked by git; an uncommitted Edit is fine for ad-hoc iteration but easy to lose. Recommendation: the skill suggests a commit after a successful Edit (one shell-out to `git add + commit -m "edit-instructions: <node>"`), but does not enforce. The user can decline and stage manually.

## 8. Verification targets

- **Unit:**
  - `npx vitest run src/attractor/tests/agent-prep.test.ts` — new cases for `NODE_ID`, `PIPELINE_NAME`, `AGENT_FILE_PATH` injection.
  - `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts` — new cases confirming the three keys are accepted by the input validator without firing `bare_input_not_in_caller_inputs_or_system`.
  - `npx vitest run src/cli/tests/slash-commands.test.ts` (or new path) — assert `parseSlashCommand("/edit-instructions") === { kind: "edit-instructions" }` and `HELP_TEXT` contains the new row.
- **Type-check:** `npx tsc --noEmit` — exercises the `SlashCommand` union exhaustiveness; any switch on `kind` that misses the new variant becomes a type error.
- **Manual exercise:**
  1. Run any pipeline with an interactive chat node (e.g. `apparat pipeline run illumination-to-implementation .` and reach `chat_session`).
  2. Confirm footer shows `/edit-instructions` in the hint line.
  3. Type `/edit-instructions`. Agent should print its current `.md` body inside a fence and ask "what would you like to change?".
  4. Describe an edit ("always read source files before answering"). Agent proposes a unified diff and reasons about behavioural impact citing the actual node id and pipeline name.
  5. Type `yes`. Confirm `.apparat/pipelines/<name>/<agent>.md` reflects the change. Open the file in a separate terminal to verify on-disk content.
  6. Type `/end`. Re-run the same pipeline. Confirm new instructions take effect (e.g. the agent now reads source first without being asked).
- **Negative path:** invoke `/edit-instructions` in a non-interactive context (or before a chat session starts). Dispatcher rejects with a one-line message ("`/edit-instructions` is only available during interactive chat nodes."); pipeline state unaffected.
- **Surfaces touched:** engine handlers, CLI slash dispatch, interaction driver footer, bundled skill, tests, README, pipelines.md.
