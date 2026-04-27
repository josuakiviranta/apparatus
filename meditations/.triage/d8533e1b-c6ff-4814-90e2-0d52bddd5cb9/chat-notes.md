# Chat round notes — 2026-04-27T11:21:44Z

## What the user raised

- **Graphviz dependency for visualization**: User reported prior pain — "I had downloaded the graphviz with brew and if I want other people to visualize their graphs too after pulling this project from github how this can be achieved?" Concern was that requiring `brew install graphviz` is a barrier for contributors who clone the repo.

- **SVG rendering confusion**: User reported that `.svg` files "just render svg code" — they had only ever opened SVG inside a code editor (VS Code), not double-clicked from Finder where macOS would open it in Preview/Safari natively.

- **Mermaid value vs install friction**: User pushed back on mermaid as a portable alternative — "What is VS code mermaid preview? Do I need to install some extension?" After learning VS Code mermaid required an extension and the workflow involved pasting into a `.md` file, user said "I think mermaid at this point is YAGNI."

- **Auto-installer for graphviz**: User asked "Can we just have some installation script for graphviz when user clones or pulls the repo with a ralph command to draw dot file as png? Or is this complicated?"

- **Trust of dependency authors**: User asked about `@hpcc-js/wasm-graphviz` authors — "Can I trust the authors tho?" and asked if I knew HPCC Systems. Wanted independent verification before locking the dep.

- **Why not just default PNG via graphviz**: User asked "why are we doing this again? It would be awesome just to have a command that gives the png picture of the current dot file like graphviz does."

- **SVG vs PNG for default**: After learning SVG opens natively across OSes, user said "let's keep SVG if you really say that it is somehow better fro large graphs. However, explain your reasoning for this." After hearing reasoning (sharp at any zoom, smaller files, searchable text, embeddable in markdown specs, git-diffable, future interactivity), user said "let's go default svg then and drop --png flag."

- **Stdout vs file output**: User pushed back on writing files at all — "Why write any files why not just tsdout only? I assume this can be called as many times as wanted." Then later for the binary-output case re-accepted writing the SVG to disk because stdout-binary doesn't make sense.

- **Failure handling philosophy**: User said "I would stay keep things simple as possible without any flags. If fails catch it and don't move on before failure is fixed."

- **Filter flags (`--focus`, `--flow`)**: User picked option (c) defer entirely — ship without filters, add only if proven painful in practice.

- **Walker / IR layer**: User accepted "drop the walker" — direct path from DOT bytes to graphviz to SVG file, no intermediate representation.

- **Trace integration**: User picked option (a) defer — show ships standalone.

- **Validator hint integration**: User picked option (a) drop entirely.

- **Tests**: User picked option (d) smoke + behavior assertions, no golden snapshots, after analogy explanation comparing golden snapshots to brittle pixel-by-pixel photo matching.

- **Output path and overwrite**: User picked option (a) — `<basename>.svg` next to source, overwrite silently.

- **Git tracking of `.svg` files**: User picked option (a) — commit them.

- **DOT styling**: User picked option (a) — pure passthrough, no auto-injected colors.

- **Modifying illumination directly**: User asked if I could modify the illumination file itself so verifier gets the refined context. I declined per agent-level hard rules; explained the pipeline's loop-back mechanism through chat-notes → chat_summarizer → refinements channel.

## Conclusions reached

- **Single output format = SVG.**
  - Came from: SVG vs PNG question after WASM graphviz unlocked both for free
  - Rationale: User accepted reasoning that SVG wins for pipeline graphs specifically — sharp at any zoom (matters for 17+ node graphs where labels need reading), tiny text-based files, searchable via browser Cmd+F, embeddable in markdown specs with sharp retina rendering, git-diffable (binary PNGs are not), future-proof for clickable interactivity. PNG's only advantages (faster macOS Preview launch, legacy tool support) don't apply to ralph's dev-tool context.

- **Renderer = `@hpcc-js/wasm-graphviz` (WebAssembly graphviz bundled inside ralph).**
  - Came from: graphviz portability concern + auto-installer question
  - Rationale: User wanted "other people to visualize after pulling from github" without a brew/apt install step. Auto-install scripts are an anti-pattern (sudo prompts, platform-specific package managers, security concerns). WASM graphviz collapses the dilemma — ships as an npm dep, runs in Node, zero system install required for any contributor on any OS. Trust verified: Apache-2.0, maintained by LexisNexis Risk Solutions (RELX Group, public company), version 1.21.2, last published 2026-03-16.

- **Zero flags. No `--png`, `--svg`, `--mermaid`, `--focus`, `--flow`, `--out`, `--force`.**
  - Came from: user's KISS preference repeated across multiple branches ("keep things simple as possible without any flags", "I think mermaid at this point is YAGNI", "drop --png flag", picked defer for filters)
  - Rationale: User consistently chose the simplest possible surface at every branch. Single command shape: `ralph pipeline show <file.dot>`. Output always SVG, always next to source, always overwrite. If filters or alternative formats prove painful later, add them then with a fresh illumination.

- **Validate-first, fail-fast on errors. No render if validation fails.**
  - Came from: "If fails catch it and don't move on before failure is fixed"
  - Rationale: User prefers strict gates over conditional fallbacks. Reuses existing `parseDot` and `validateGraph` from `src/attractor/core/graph.ts`. On validate failure: print errors with file:line:col diagnostics, exit 1, no SVG written. On validate success: pass DOT bytes to WASM graphviz, write SVG.

- **Drop the proposed `previewGraph(graph, opts)` walker. No `src/attractor/preview/` directory.**
  - Came from: user accepted "drop the walker" after explanation that the IR layer was justified only when we had multiple renderers (mermaid + svg + ascii) and filters (--focus, --flow). With those gone, the walker was YAGNI.
  - Rationale: Direct path read DOT → validate → graphviz → write SVG. No new abstraction layer. No new directory.

- **Pure DOT passthrough. No ralph-injected styling.**
  - Came from: user picked (a) pure passthrough
  - Rationale: Walker was killed; injecting styling would resurrect parse-mutate-emit machinery for cosmetics. Existing `.dot` files already use `shape=hexagon` for gates, `shape=Mdiamond` for start, `shape=Msquare` for done — graphviz renders those correctly without help. If user wants colors, they edit the source DOT directly. Source-of-truth principle.

- **Output written to `<basename>.svg` in same directory as source. Silent overwrite.**
  - Came from: user picked (a) for output behavior + accepted concrete example showing `pipelines/illumination-to-implementation.dot` → `pipelines/illumination-to-implementation.svg`
  - Rationale: Same-dir colocation enables relative-link embedding in markdown specs (`![](illumination-to-implementation.svg)`). Silent overwrite matches the common workflow (edit DOT, re-run, view) — refuse-with-flag adds friction. No `--force` flag needed.

- **`.svg` files are committed to the repo, not gitignored.**
  - Came from: user picked (a) commit
  - Rationale: SVG is text → git tracks meaningful diffs. PR reviewers see updated diagram in same commit as DOT change. GitHub renders `.svg` in PR file diffs. Self-documenting repo. Stale-drift risk acknowledged but small; convention "if you change `.dot`, run `ralph pipeline show`" is enough — pre-commit hook would be premature machinery (YAGNI).

- **Tests = smoke + behavior assertions, no golden file snapshots.**
  - Came from: user picked (d) after pizza-shop analogy explanation
  - Rationale: WASM graphviz IS the renderer — we trust HPCC's camera works. Tests verify the BUTTON ralph wires up: did it find the file, did it pass DOT through, did it write the result, did it refuse on broken DOT. Smoke = "valid DOT exits 0, file exists, contains `<svg`". Behavior = "broken DOT exits 1, stderr contains validate errors, no SVG written". Golden byte-snapshots would test graphviz's rendering (wrong layer) and break on graphviz version bumps.

- **`pipeline trace` integration deferred.** Show ships standalone.
  - Came from: user picked (a) defer
  - Rationale: Path-highlighting on traversed edges would require resurrecting a coloring walker. Out of scope for the minimum command. Future enhancement gets its own illumination.

- **Validator hint integration dropped.** Validate errors do NOT append "run `pipeline show ...` for context".
  - Came from: user picked (a) drop
  - Rationale: With no `--focus` flag and show fail-fasting on validate errors anyway, the hint is tautological. Validate already prints file:line:col with carets (v0.1.31). User who fixes errors will run show on their own.

- **Companion-illumination dependencies all collapsed to zero.**
  - Came from: walker drop chain reaction
  - Rationale: T2200 (explicit consumes) was needed for `[+var]` edge badges → no walker means no edge mutation → no dependency. T2000 (vocab rename) was needed to avoid golden-file churn → no goldens means no dependency. T0400 (validate-semantics) feeds in via fail-fast but doesn't gate anything new. Show command can ship in any order relative to all three.

## Open questions

- **WASM graphviz error handling at render time** — if graphviz itself errors on valid-parsed DOT (rare), surface its error verbatim or wrap? Deferred because: not a blocker for design, can be settled at implementation time when we see actual error shapes from the library.

- **Edge cases on output write failure** — disk full, read-only filesystem, etc. Deferred because: standard fs error handling, no design-level decision needed.

- **Code location for command registration** — confirm exact placement in `src/cli/commands/pipeline.ts` alongside the existing six subcommands. Deferred because: implementation detail, not a design decision.
