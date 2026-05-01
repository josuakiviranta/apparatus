import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const agentPath = join(__dirname, "..", "pipelines", "implement", "implement.md");

describe("implement template agent prompt body — discover-then-read orientation", () => {
  it("contains the source-root discovery glob", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    // Body must Glob common source roots, not preload a specs dir
    expect(body).toMatch(/src\/.*lib\/.*app\/.*pkg\/.*cmd\/.*internal\//s);
  });

  it("references CONTEXT.md and docs/adr/ for orientation", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const body = agentMd.slice(agentMd.match(/^---\n[\s\S]+?\n---\n/)![0].length);

    expect(body).toMatch(/CONTEXT\.md/);
    expect(body).toMatch(/docs\/adr/);
  });

  it("contains zero literal $specs_dir references", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const body = agentMd.slice(agentMd.match(/^---\n[\s\S]+?\n---\n/)![0].length);

    expect(body).not.toMatch(/\$specs_dir/);
    expect(body).not.toMatch(/specs_dir/);
  });
});

describe("implement template agent frontmatter — inputs declaration", () => {
  it("does NOT declare specs_dir as a frontmatter input", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n([\s\S]+?)\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const fm = frontmatterMatch![1];

    expect(fm).not.toMatch(/^\s*-\s+specs_dir\s*$/m);
  });
});
