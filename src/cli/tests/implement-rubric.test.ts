import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("implement template agent prompt body — specs path portability", () => {
  it("uses $specs_dir token, not literal specs/", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "pipelines", "implement", "implement.md"),
      "utf-8",
    );
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    expect(body).toMatch(/\$specs_dir/);
    // ensure no path-glob literal `specs/` remains (concept-references like "the specs" are fine)
    expect(body).not.toMatch(/`specs\/\*`/);
    expect(body).not.toMatch(/specs\/\\\*/);
  });
});
