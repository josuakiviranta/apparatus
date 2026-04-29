import { describe, it, expect } from "vitest";
import { renderInputsBlock } from "../transforms/inputs-renderer.js";

describe("renderInputsBlock", () => {
  it("renders empty Inputs section when inputs list is empty", () => {
    const out = renderInputsBlock([], {}, {});
    expect(out).toBe("## Inputs\n\n");
  });

  it("renders bare input from ctx.values", () => {
    const out = renderInputsBlock(["project"], { project: "/repo" }, {});
    expect(out).toContain("<project>/repo</project>");
  });

  it("renders qualified input with underscore-swapped tag", () => {
    const out = renderInputsBlock(
      ["verifier.summary"],
      { "verifier.summary": "auth bug" },
      {},
    );
    expect(out).toContain("<verifier_summary>auth bug</verifier_summary>");
  });

  it("falls back to node default when ctx value is missing", () => {
    const out = renderInputsBlock(
      ["refinements"],
      {},
      { default_refinements: "(none)" },
    );
    expect(out).toContain("<refinements>(none)</refinements>");
  });

  it("falls back to default for qualified input using local key default", () => {
    const out = renderInputsBlock(
      ["chat_summarizer.refinements"],
      {},
      { default_refinements: "" },
    );
    expect(out).toContain("<chat_summarizer_refinements></chat_summarizer_refinements>");
  });

  it("preserves multi-line values verbatim", () => {
    const explainer = "## Before\n\n- a\n- b\n\n## After\n\n- c";
    const out = renderInputsBlock(
      ["explainer.explainer_render"],
      { "explainer.explainer_render": explainer },
      {},
    );
    expect(out).toContain(`<explainer_explainer_render>\n${explainer}\n</explainer_explainer_render>`);
  });

  it("passes raw < and > characters through verbatim (no escaping)", () => {
    const out = renderInputsBlock(
      ["sample.code"],
      { "sample.code": "if (x < 5 && y > 2)" },
      {},
    );
    expect(out).toContain("<sample_code>");
    expect(out).toContain("</sample_code>");
    expect(out).toContain("if (x < 5 && y > 2)");
  });
});
