import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { annotateDotForShow } from "../lib/annotate-show.js";

function makeFixture(agentBody: string): { dir: string; dot: string } {
  const dir = mkdtempSync(join(tmpdir(), "annotate-show-"));
  writeFileSync(join(dir, "v.md"), `---\n${agentBody}---\nbody`);
  const dot = `digraph { start [shape=Mdiamond]; v [agent="v"]; start -> v; }`;
  return { dir, dot };
}

describe("annotate-show renders model + thinking on agent labels", () => {
  it("renders 'sonnet' alone when thinking is off", () => {
    const { dir, dot } = makeFixture(
      "name: v\ndescription: x\nmodel: sonnet\nthinking: off\ninputs: []\noutputs:\n  ok: boolean\n"
    );
    const out = annotateDotForShow(dot, dir);
    expect(out).toContain("sonnet");
    expect(out).not.toContain("think:");
  });

  it("renders 'opus · think:high' when thinking is high", () => {
    const { dir, dot } = makeFixture(
      "name: v\ndescription: x\nmodel: opus\nthinking: high\ninputs: []\noutputs:\n  ok: boolean\n"
    );
    const out = annotateDotForShow(dot, dir);
    expect(out).toContain("opus · think:high");
  });

  it("renders model alone when thinking is undefined", () => {
    const { dir, dot } = makeFixture(
      "name: v\ndescription: x\nmodel: haiku\ninputs: []\noutputs:\n  ok: boolean\n"
    );
    const out = annotateDotForShow(dot, dir);
    expect(out).toContain("haiku");
    expect(out).not.toContain("think:");
  });
});
