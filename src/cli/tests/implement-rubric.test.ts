import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const agentPath = join(__dirname, "..", "pipelines", "implement", "implement.md");

describe("implement template agent prompt body — specs path portability", () => {
  it("uses $specs_dir token, not literal specs/", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    expect(body).toMatch(/\$specs_dir/);
    // ensure no path-glob literal `specs/` remains (concept-references like "the specs" are fine)
    expect(body).not.toMatch(/`specs\/\*`/);
    expect(body).not.toMatch(/specs\/\\\*/);
  });
});

describe("implement template agent frontmatter — inputs declaration", () => {
  it("declares an `inputs:` block listing specs_dir (validator contract)", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n([\s\S]+?)\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const fm = frontmatterMatch![1];
    // The inputs: block must exist (otherwise validator emits inputs_missing_frontmatter)
    expect(fm).toMatch(/^inputs:/m);
    // The rubric body references $specs_dir; the frontmatter must declare it
    expect(fm).toMatch(/^\s*-\s+specs_dir\s*$/m);
  });
});
