# Architecture

## Package

| Field | Value |
|---|---|
| npm name | `ralph-cli` |
| binary | `ralph` |
| runtime | Node.js >=18 |
| build | tsup (CJS output) |
| arg parsing | commander |

## File Structure

```
ralph-cli/
├── src/cli/
│   ├── index.ts              # CLI entry, commander setup
│   ├── commands/
│   │   ├── plan.ts           # plan command
│   │   └── implement.ts      # implement command
│   ├── lib/
│   │   ├── prompts.ts        # bootstrap logic
│   │   └── assets.ts         # asset path resolution (dev vs prod)
│   └── prompts/
│       ├── PROMPT_plan.md    # bundled default
│       └── PROMPT_build.md   # bundled default
├── loop.sh                   # bundled into dist/ at build time
├── tsup.config.ts            # builds src/cli → dist/, copies assets
└── dist/                     # published artifact (not committed)
```

## Asset Bundling

`tsup.config.ts` copies `loop.sh`, `PROMPT_plan.md`, and `PROMPT_build.md` into `dist/` alongside the compiled JS.

At runtime, asset paths are resolved relative to `dist/index.js` via `__dirname` (works for both dev `tsx` and production).
