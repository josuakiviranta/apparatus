---
source: https://www.youtube.com/watch?v=3MP8D-mdheA
date: 2026-05-04
description: Agent that prefers deep modules — simple interface, lots of hidden implementation — over shallow ones, because depth concentrates change (locality) and gives callers more capability per unit of interface they have to learn (leverage).
---

# Deep Modules Hide Complexity

AI accelerates software entropy. Every change made without considering the whole codebase introduces small wrongnesses that snowball into a ball of mud — faster than ever, because agents commit faster than humans ever could. The cure is the same as the prevention: build deep modules.

## Vocabulary (share this with the agent)

- **Module** — a unit of the application: a logger, an auth boundary, a page-shaped cluster of components. Whatever the code groups together to do one job.
- **Interface** — everything a caller must know to use the module correctly. Method signatures *and* the documentation about how/when to call them.
- **Implementation** — what happens behind the interface when you call it.
- **Depth** — behavior a caller can exercise per unit of interface they have to learn. From John Ousterhout, *A Philosophy of Software Design*.
- **Deep module** — simple interface, lots of implementation hidden. Good. (TanStack Query is the canonical "deep" library.)
- **Shallow module** — complex interface, almost nothing behind it. Bad. Forces callers to learn surface that gives them little.
- **Seam** — the location where one module's interface meets another. Tests and mocks live at seams. Knowing where your seams are is most of the architecture.
- **Adapter** — a concrete thing that satisfies an interface at a seam. Real-clock adapter in production, fake-clock adapter in tests. (From hexagonal architecture.)

## Why deep is better

Two payoffs, on opposite sides of the interface:

- **For the maintainer: locality.** Changes and bugs concentrate in one module. Low locality = changes spread across modules, every fix is a hunt. High locality = the change is *here*, and only here.
- **For the caller: leverage.** Tiny interface, huge capability. They learn one symbol and unlock a system.

When you're improving a codebase, those are the two things you're aiming at. Every refactor decision can be checked: does this raise locality? Does this raise leverage? If neither, don't bother.

## What "shallow" looks like in the wild

- A concept implemented twice (front end and back end, or two layers) with no single seam where they're forced to agree. Drift between parallel implementations is a shallow-module symptom.
- Modules whose interface is almost as big as their implementation — wrappers that don't hide anything.
- "Manager" or "helper" modules that expose internal structure rather than concealing it.
- Legacy codebases. "Legacy" usually just means "lots of shallow modules" — code that's hard to change because every change touches many surfaces.

## How to apply this in practice

1. **Hunt for deepening opportunities.** Look at the module map and ask: where is the interface big relative to what's behind it? Where do two implementations need to agree but no seam enforces it?
2. **Pick one candidate.** Don't try to deepen everything at once.
3. **Sketch the proposed interface first.** What would the *simple* version look like — the one the caller wishes existed?
4. **Move implementation behind it.** Collapse the duplicates, hide the parallel paths, force agreement through a single seam.
5. **Put the test at the seam.** A deep module with a clean seam is testable with one mock at one boundary. Shallow modules require many mocks because there are many small interfaces to satisfy.

## Why this matters more with agents

Agents are excellent **tactical** programmers — fast, cheap, willing to do the boring move. They are not strategic. They will not, on their own, decide that two parallel implementations should collapse into one deep module. That call comes from the human above them.

So the loop is: agent finds candidates, human picks the one worth deepening, agent does the move. Run this regularly — every few days in a fast-moving codebase — because shallow modules accumulate silently, and entropy compounds.

A legacy codebase that you want to bring an agent into needs a *harness* before you let the agent loose: tests around deep modules with clear seams. Without that, the agent's speed becomes a liability. With it, depth and leverage compound in your favour instead of against you.
