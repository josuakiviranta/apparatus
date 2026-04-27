import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

// Minimal valid gate .md with type: gate and choices
function gateFileMd(choices: string[]): string {
  return `---
type: gate
choices:
${choices.map(c => `  - ${c}`).join("\n")}
---
Please make a choice.
`;
}

// Minimal valid gate .md missing the required type field
function gateMdMissingType(choices: string[]): string {
  return `---
choices:
${choices.map(c => `  - ${c}`).join("\n")}
---
Please make a choice.
`;
}

// Minimal valid pipeline DOT with one hexagon gate node
function minimalDotWithGate(gateAttrs: string, extraEdges: string = ""): string {
  return `digraph g {
    start [shape=Mdiamond]
    gate [shape=hexagon${gateAttrs ? ", " + gateAttrs : ""}]
    done [shape=Msquare]
    start -> gate
    gate -> done${extraEdges ? "\n    " + extraEdges : ""}
  }`;
}

describe("validator — gate handlers", () => {
  it("inline label only, no .md → no gate-related diagnostics", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gate-test-"));
    try {
      const dot = minimalDotWithGate(`label="Pick an option"`);
      const graph = parseDot(dot);
      const diags = validateGraph(graph, tmp);
      const gateRules = ["gate_handler_missing", "gate_inline_md_conflict", "gate_md_parse_error", "gate_choice_edge_mismatch"];
      for (const rule of gateRules) {
        expect(diags.find(d => d.rule === rule), `rule ${rule} should not fire`).toBeUndefined();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("valid .md, no inline label, edge labels match choices exactly → no gate-related diagnostics", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gate-test-"));
    try {
      writeFileSync(join(tmp, "gate.md"), gateFileMd(["yes", "no"]));
      const dot = `digraph g {
        start [shape=Mdiamond]
        gate [shape=hexagon]
        done [shape=Msquare]
        start -> gate
        gate -> done [label="yes"]
        gate -> done [label="no"]
      }`;
      const graph = parseDot(dot);
      const diags = validateGraph(graph, tmp);
      const gateRules = ["gate_handler_missing", "gate_inline_md_conflict", "gate_md_parse_error", "gate_choice_edge_mismatch"];
      for (const rule of gateRules) {
        expect(diags.find(d => d.rule === rule), `rule ${rule} should not fire`).toBeUndefined();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no label and no .md → 1 gate_handler_missing diagnostic containing node id", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gate-test-"));
    try {
      const dot = minimalDotWithGate("");
      const graph = parseDot(dot);
      const diags = validateGraph(graph, tmp);
      const d = diags.find(d => d.rule === "gate_handler_missing");
      expect(d).toBeDefined();
      expect(d!.severity).toBe("error");
      expect(d!.message).toContain("gate");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("inline label AND .md both present → 1 gate_inline_md_conflict", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gate-test-"));
    try {
      writeFileSync(join(tmp, "gate.md"), gateFileMd(["A", "B"]));
      const dot = minimalDotWithGate(`label="Pick"`);
      const graph = parseDot(dot);
      const diags = validateGraph(graph, tmp);
      const d = diags.find(d => d.rule === "gate_inline_md_conflict");
      expect(d).toBeDefined();
      expect(d!.severity).toBe("error");
      expect(d!.message).toContain("gate");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(".md exists but missing required type field → 1 gate_md_parse_error containing node id", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gate-test-"));
    try {
      writeFileSync(join(tmp, "gate.md"), gateMdMissingType(["A", "B"]));
      const dot = minimalDotWithGate("");
      const graph = parseDot(dot);
      const diags = validateGraph(graph, tmp);
      const d = diags.find(d => d.rule === "gate_md_parse_error");
      expect(d).toBeDefined();
      expect(d!.severity).toBe("error");
      expect(d!.message).toContain("gate");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(".md declares [A,B], edges labeled [A,C] → 1 gate_choice_edge_mismatch listing B (declared, no edge) AND C (edge, not declared)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gate-test-"));
    try {
      writeFileSync(join(tmp, "gate.md"), gateFileMd(["A", "B"]));
      const dot = `digraph g {
        start [shape=Mdiamond]
        gate [shape=hexagon]
        done [shape=Msquare]
        start -> gate
        gate -> done [label="A"]
        gate -> done [label="C"]
      }`;
      const graph = parseDot(dot);
      const diags = validateGraph(graph, tmp);
      const d = diags.find(d => d.rule === "gate_choice_edge_mismatch");
      expect(d).toBeDefined();
      expect(d!.severity).toBe("error");
      expect(d!.message).toContain("B");
      expect(d!.message).toContain("C");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(".md declares [A,B], but two outgoing edges have no label at all → gate_choice_edge_mismatch mentions unlabeled edge count", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gate-test-"));
    try {
      writeFileSync(join(tmp, "gate.md"), gateFileMd(["A", "B"]));
      const dot = `digraph g {
        start [shape=Mdiamond]
        gate [shape=hexagon]
        done [shape=Msquare]
        start -> gate
        gate -> done
        gate -> done
      }`;
      const graph = parseDot(dot);
      const diags = validateGraph(graph, tmp);
      const d = diags.find(d => d.rule === "gate_choice_edge_mismatch");
      expect(d).toBeDefined();
      expect(d!.severity).toBe("error");
      expect(d!.message).toMatch(/outgoing edge\(s\) have no label/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dotDir is undefined → skip all four rules (no gate diagnostics even for gate with no label)", () => {
    const dot = minimalDotWithGate("");
    const graph = parseDot(dot);
    const diags = validateGraph(graph); // no dotDir
    const gateRules = ["gate_handler_missing", "gate_inline_md_conflict", "gate_md_parse_error", "gate_choice_edge_mismatch"];
    for (const rule of gateRules) {
      expect(diags.find(d => d.rule === rule), `rule ${rule} should not fire without dotDir`).toBeUndefined();
    }
  });
});
