import { describe, it, expect } from "vitest";
import { formatPipelineDiag } from "../lib/pipeline-diag-format.js";
import { renderCodeFrame } from "../lib/code-frame.js";
import type { Diagnostic } from "../../attractor/types.js";

describe("formatPipelineDiag", () => {
  const src = ["line1", "line2", "line3 bad here", "line4", "line5"].join("\n");
  const indent2 = (s: string) => s.split("\n").map(l => `  ${l}`).join("\n");

  it("formats diagnostic with location, rule, message — exact bytes", () => {
    const d: Diagnostic = {
      rule: "schema_error",
      severity: "error",
      message: "bad key",
      location: { line: 3, column: 7 },
    };
    const out = formatPipelineDiag(d, src, "pipelines/foo.dot");
    const frame = renderCodeFrame(src, { line: 3, column: 7 }, { context: 2, color: false });
    const expected = `pipelines/foo.dot:3:7 [schema_error] bad key\n${indent2(frame)}`;
    expect(out).toBe(expected);
  });

  it("omits location prefix and code frame when diagnostic has no location", () => {
    const d: Diagnostic = {
      rule: "schema_error",
      severity: "error",
      message: "bad key",
    };
    const out = formatPipelineDiag(d, "irrelevant", "pipelines/foo.dot");
    expect(out).toBe("[schema_error] bad key");
  });

  it("interleaves indented hint between message and frame", () => {
    const d: Diagnostic = {
      rule: "schema_error",
      severity: "error",
      message: "bad key",
      hint: "try X instead",
      location: { line: 3, column: 7 },
    };
    const out = formatPipelineDiag(d, src, "pipelines/foo.dot");
    const frame = renderCodeFrame(src, { line: 3, column: 7 }, { context: 2, color: false });
    const expected =
      `pipelines/foo.dot:3:7 [schema_error] bad key\n${indent2("try X instead")}\n${indent2(frame)}`;
    expect(out).toBe(expected);
  });
});
