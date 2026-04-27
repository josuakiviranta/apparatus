import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../lib/frontmatter.js";

describe("parseFrontmatter — outputs block", () => {
  it("parses a typed outputs map with inline JSON Schema fragments", () => {
    // YAML reserved-word quirk: `true` / `false` / `yes` / `no` / `null` are
    // parsed as their typed values by js-yaml. Authors who want them as string
    // enum members MUST quote them. The verifier's `preferred_label` is a
    // string enum, so we quote here and document the gotcha for migrators.
    const input = `---
name: verifier
model: opus
outputs:
  preferred_label: {enum: ["true", "false", empty]}
  illumination_path: string
  archive_reason_short: {type: string, maxLength: 100}
---
# Mission
Body here.`;

    const { attributes } = parseFrontmatter(input);

    expect(attributes.name).toBe("verifier");
    expect(attributes.outputs).toEqual({
      preferred_label: { enum: ["true", "false", "empty"] },
      illumination_path: "string",
      archive_reason_short: { type: "string", maxLength: 100 },
    });
  });

  it("treats unquoted YAML reserved words as their typed values (gotcha doc)", () => {
    // Locks the gotcha: unquoted `true`/`false` become booleans. Migrators
    // must quote when they need string members in an enum.
    const input = `---
name: x
outputs:
  flag: {enum: [true, false, empty]}
---
body`;
    const { attributes } = parseFrontmatter(input);
    expect((attributes.outputs as any).flag).toEqual({
      enum: [true, false, "empty"],
    });
  });

  it("returns no outputs key when frontmatter omits it", () => {
    const input = `---
name: legacy-agent
model: sonnet
---
# Mission`;

    const { attributes } = parseFrontmatter(input);
    expect(attributes.outputs).toBeUndefined();
  });
});
