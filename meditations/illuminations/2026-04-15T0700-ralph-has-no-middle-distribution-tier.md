---
date: 2026-04-14
status: open
description: The T-series patches project-local and ralph-built-in distribution but leaves the middle tier empty — teams that want consistent ralph pipelines across multiple projects have no installable preset package format and must fork ralph-cli or manually copy .dot files.
---

## Core Idea

ralph's pipeline distribution has two tiers: project-local (`$project/pipelines/*.dot`) and ralph-built-in (the bundled library T2300 proposes). The T-series illuminations collectively patch both tiers. But the middle tier — organization-level or domain-level pipeline libraries shared across many projects, independently of ralph-cli's release cycle — does not exist and has not been named. A team that accumulates five good pipelines across six projects today has three options: copy `.dot` files by hand (drift inevitable), PR them into ralph-cli (gatekeeping, wrong scope), or fork ralph-cli (maintenance burden). None of these options fit the actual use case: a team wants `@acme/ralph-pipelines` — an npm package that encapsulates their accumulated pipeline design judgment and applies it consistently to every project that installs it.

## Why It Matters

The gene transfusion lens names the cost precisely: the first transfusion is expensive. Right now, every project in an organization performs that first transfusion in isolation. They get context-blind `pipeline create` sessions (T0000), no pattern vocabulary (T0100), no `ralph.config.js` (T0300), no `ralph init` (T0500) — and even after all T-series gaps are closed, each project still starts from zero. A team pipeline library is what makes the second, third, and twentieth project's first transfusion cheap: the exemplars, handlers, agents, and variable defaults are pre-loaded from the package.

The semport lens adds the forward dimension. An organization's pipeline library is a living upstream. When the team improves their `ci-loop.dot` (better retry logic, new gate conditions, updated agent names), those improvements should propagate automatically to every dependent project — not via manual file distribution but via `npm update @acme/ralph-pipelines`. The library version-locks the design; projects explicitly upgrade. This is exactly the model `vite.config.js` presets and `eslint` shareable configs established — and it's absent from ralph.

The current `pipeline-resolver.ts` has one resolution path: `$project/pipelines/$name.dot`. T2300 proposes a two-tier fallback: project-local first, then `getBundledPipelinesDir()`. But that function returns one directory — ralph-cli's own bundled pipelines. It cannot be a list of directories. There is no affordance in the resolver for "also search the installed preset package." Similarly, T0300's `loadProjectManifest` composes nothing: it reads one `ralph.config.js` and stops. If a preset package exports its own manifest fields, there is no merge path. Each call to `loadProjectManifest` would need to know about the preset to compose it — and no such composition is designed.

## Revised Implementation Steps

1. **Define the ralph preset package shape.** A preset is an npm package with a default export conforming to `RalphManifest` (T0300's interface). It may additionally contain a `pipelines/` directory of `.dot` files and a `schemas/` directory. Document this in `specs/` as `preset-packages.md`. The shape must be narrow enough to implement in a day: `{ handlers?, variables?, agents?, pipelines? }` — exactly T0300's `RalphManifest` fields. No new fields required.

2. **Add `preset: string` to `ralph.config.js` schema** (the field T0300 designs). The value is an npm package name or a local path. In `loadProjectManifest` (T0300's shared loader in `src/cli/lib/manifest.ts`), after reading `ralph.config.js`, if `preset` is present, dynamically import it from `node_modules` and merge: preset fields are base layer, project `ralph.config.js` fields override. Precedence: project manifest wins over preset. One `try/catch` wraps the preset import with a helpful error if the package isn't installed.

3. **Extend `pipeline-resolver.ts` to search preset pipeline directories.** After T2300 adds `getBundledPipelinesDir()`, update the resolver to accept an ordered list of search directories: `[project/pipelines, ...presetPipelineDirs, bundledPipelinesDir]`. Project-local always wins. Preset pipelines come before ralph built-ins. The resolver walks the list and returns the first match. This is one function signature change and a loop — no architectural redesign.

4. **Add `ralph init --preset <package>` flag** to the `ralph init` command T0500 proposes. When `--preset` is given, the command runs `npm install <package>` (with a confirmation prompt), then writes `ralph.config.js` with `preset: "<package>"` as the first field. The rest of the init flow (detect project type, scaffold `pipelines/`, write conventions) runs after preset merge, so detected values can override preset defaults. This is the one command that onboards a team member into an org-standard ralph configuration.

5. **Scaffold a `ralph-preset-template` example** as a new directory under `docs/` or `examples/`. It should contain: `index.js` exporting a manifest, `pipelines/ci-loop.dot` as a demonstration, `README.md` explaining the preset format. This is the gene transfusion artifact — the exemplar a team author reads to build their own. Without a concrete example, the preset API is invisible even after it's implemented. The docs page is the discoverability surface.
