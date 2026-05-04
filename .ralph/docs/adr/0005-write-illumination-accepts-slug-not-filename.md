# 0005: write_illumination accepts a slug, not a filename

**Date:** 2026-05-01
**Status:** Accepted (salvaged from docs/specs/mcp-illumination.md before deletion)

## Context

The MCP illumination server exposes `write_illumination` as the only path through which Claude (during meditate or pipeline runs) can persist insight files into `meditations/illuminations/`. The tool's parameter shape is a deliberate choice: it accepts a kebab-case **slug**, never a filename.

From the spec being salvaged (`docs/specs/mcp-illumination.md`):

> Provide a kebab-case `slug` (lowercase alphanumeric + hyphens, e.g. `janitor-doc-drift` or `my-insight`); the server prepends the current `YYYY-MM-DDTHHMM-` timestamp and appends `.md` — do not include either yourself.

The implementation enforces this in `src/cli/mcp/illumination-server.ts` via `composeIlluminationFilename(slug)`, which builds the final filename as `YYYY-MM-DDTHHMM-<slug>.md`.

## Decision

`write_illumination` accepts a semantic slug; the server owns the timestamp prefix and `.md` suffix. Clients (Claude or anything calling the MCP server) must not pass a pre-timestamped or `.md`-suffixed string.

## Consequences

**Positive:**
- Filename uniqueness is guaranteed by server-controlled minute-precision timestamps; clients cannot collide.
- Sort order in `ls meditations/illuminations/` is chronological without coordination.
- Slug-based input keeps Claude's tool calls focused on semantics, not formatting.

**Negative:**
- A client passing a full filename (e.g. forgetting the convention) silently produces a malformed name like `2026-05-01T1234-2026-05-01T1100-foo.md`. Mitigated by the spec language and tool description. (Inferred — the spec did not call this out explicitly.)
- Two illuminations created in the same minute with the same slug collide on filename and one will overwrite the other. Mitigated by the unlikelihood of identical slugs in the same minute.

## Related

- Salvaged from `docs/specs/mcp-illumination.md` on 2026-05-01 during the source-as-truth excision
- See ADR-0004 for the broader excision rationale
- Spec: `docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md`
