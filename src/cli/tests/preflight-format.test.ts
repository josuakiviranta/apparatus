import { describe, it, expect } from "vitest";
import {
  formatMissingInputsError,
  formatLegacyMissingWarning,
  formatUndeclaredWarning,
} from "../lib/preflight-format.js";

describe("formatMissingInputsError", () => {
  it("includes pipeline name, declared list, supplied keys, and the --var template", () => {
    const out = formatMissingInputsError({
      pipelineName: "illumination-to-plan",
      declared: ["illumination_path", "model", "output_dir"],
      provided: { model: "claude-opus-4-6" },
      missing: ["illumination_path", "output_dir"],
      invokedAs: "illumination-to-plan",
    });
    expect(out).toContain("PIPELINE ERROR: Missing required inputs");
    expect(out).toContain("Pipeline:   illumination-to-plan");
    expect(out).toContain("Required:   illumination_path, model, output_dir");
    expect(out).toContain("Provided:   model");
    expect(out).toContain("$illumination_path");
    expect(out).toContain("$output_dir");
    expect(out).toContain("--var illumination_path=");
    expect(out).toContain("--var output_dir=");
    expect(out).toContain("apparat pipeline run illumination-to-plan");
  });

  it("renders Provided as '(none)' when nothing supplied", () => {
    const out = formatMissingInputsError({
      pipelineName: "p",
      declared: ["a"],
      provided: {},
      missing: ["a"],
      invokedAs: "p",
    });
    expect(out).toContain("Provided:   (none)");
  });
});

describe("formatLegacyMissingWarning", () => {
  it("warns and tells the user how to recover", () => {
    const out = formatLegacyMissingWarning(["illumination_path"]);
    expect(out).toContain("PIPELINE WARNING");
    expect(out).toContain("$illumination_path");
    expect(out).toContain("does not declare `inputs=`");
    expect(out).toContain("--var illumination_path=");
  });
});

describe("formatUndeclaredWarning", () => {
  it("names the offending variables when inputs= is declared but a $var is not listed", () => {
    const out = formatUndeclaredWarning(["mystery_var"]);
    expect(out).toContain("PIPELINE WARNING");
    expect(out).toContain("$mystery_var");
    expect(out).toContain("not declared in `inputs=`");
  });
});
