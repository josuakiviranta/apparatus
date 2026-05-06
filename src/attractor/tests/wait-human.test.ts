import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import type { Interviewer, Question, Answer } from "../interviewer/index.js";
import type { Node, PipelineContext } from "../types.js";

describe("WaitHumanHandler — label variable expansion (Bug B.1)", () => {
  it("expands $var references in the label before showing to the user", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = {
      id: "gate",
      label: "Review $chat.output before continuing",
    };
    const ctx: PipelineContext = { values: { "chat.output": "the proposal text" } };
    const meta = { outgoingLabels: ["continue"] };

    await handler.execute(node, ctx, meta);

    expect(captured[0].prompt).toBe("Review the proposal text before continuing");
  });

  it("leaves unreferenced labels unchanged", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate", label: "Just continue" };
    const ctx: PipelineContext = { values: {} };
    await handler.execute(node, ctx, { outgoingLabels: ["continue"] });
    expect(captured[0].prompt).toBe("Just continue");
  });

  it("falls back to node.id when label is undefined (legacy: now returns fail without dotDir)", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate" };
    const ctx: PipelineContext = { values: {} };
    const outcome = await handler.execute(node, ctx, { outgoingLabels: ["continue"] });
    // Behavior changed in Task 3.3: no label + no dotDir → fail (use sibling .md instead)
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/no dotDir/);
  });

  it("uses default_<var> attribute when the label var is not in context", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = {
      id: "approval_gate",
      label: "Refinements: $refinements",
      defaultRefinements: "(none yet)",
    };
    const ctx: PipelineContext = { values: {} };
    await handler.execute(node, ctx, { outgoingLabels: ["continue"] });
    expect(captured[0].prompt).toBe("Refinements: (none yet)");
  });
});

describe("WaitHumanHandler — gate choice namespacing", () => {
  const makeInterviewer = (value: string): Interviewer => ({
    ask: async (): Promise<Answer> => ({ value }),
  });

  it("writes <nodeId>.choice and choice alias on success", async () => {
    const handler = new WaitHumanHandler(makeInterviewer("Approve"));
    const node: Node = { id: "approval_gate", label: "Proceed?" };
    const ctx: PipelineContext = { values: {} };
    const outcome = await handler.execute(node, ctx, { outgoingLabels: ["Approve", "Decline"] });

    expect(outcome.status).toBe("success");
    expect(outcome.preferredLabel).toBe("Approve");
    expect(outcome.contextUpdates).toEqual({
      "approval_gate.choice": "Approve",
      choice: "Approve",
    });
  });

  it("uses the exact node.id in the namespaced key", async () => {
    const handler = new WaitHumanHandler(makeInterviewer("Yes"));
    const node: Node = { id: "remove_gate", label: "Remove?" };
    const outcome = await handler.execute(node, { values: {} }, { outgoingLabels: ["Yes", "No"] });

    expect(outcome.contextUpdates?.["remove_gate.choice"]).toBe("Yes");
    expect(outcome.contextUpdates?.choice).toBe("Yes");
  });

  it("does not emit contextUpdates when aborted before prompt", async () => {
    const handler = new WaitHumanHandler(makeInterviewer("Approve"));
    const node: Node = { id: "approval_gate", label: "Proceed?" };
    const controller = new AbortController();
    controller.abort();
    const outcome = await handler.execute(node, { values: {} }, {
      outgoingLabels: ["Approve"],
      signal: controller.signal,
    });

    expect(outcome.status).toBe("fail");
    expect(outcome.contextUpdates).toBeUndefined();
  });

  it("does not emit contextUpdates when aborted during prompt", async () => {
    const controller = new AbortController();
    const interviewer: Interviewer = {
      ask: () => new Promise<Answer>(() => { /* never resolves */ }),
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = { id: "approval_gate", label: "Proceed?" };
    const p = handler.execute(node, { values: {} }, {
      outgoingLabels: ["Approve"],
      signal: controller.signal,
    });
    controller.abort();
    const outcome = await p;

    expect(outcome.status).toBe("fail");
    expect(outcome.contextUpdates).toBeUndefined();
  });

  it("two gates in sequence: prior namespaced key survives, alias tracks most recent", async () => {
    const first = new WaitHumanHandler(makeInterviewer("Approve"));
    const firstNode: Node = { id: "approval_gate", label: "Proceed?" };
    const firstOutcome = await first.execute(firstNode, { values: {} }, {
      outgoingLabels: ["Approve", "Decline"],
    });

    let merged: Record<string, unknown> = {};
    if (firstOutcome.contextUpdates) merged = { ...merged, ...firstOutcome.contextUpdates };

    const second = new WaitHumanHandler(makeInterviewer("Decline"));
    const secondNode: Node = { id: "review_gate", label: "Looks right?" };
    const secondOutcome = await second.execute(secondNode, { values: merged }, {
      outgoingLabels: ["Approve", "Decline"],
    });
    if (secondOutcome.contextUpdates) merged = { ...merged, ...secondOutcome.contextUpdates };

    expect(merged["approval_gate.choice"]).toBe("Approve");
    expect(merged["review_gate.choice"]).toBe("Decline");
    expect(merged.choice).toBe("Decline");
  });
});

describe("WaitHumanHandler — .md fallback", () => {
  const makeInterviewer = (value: string): Interviewer => ({
    ask: async (): Promise<Answer> => ({ value }),
  });

  it("happy path: loads prompt and choices from sibling .md file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-gate-test-"));
    try {
      writeFileSync(
        join(tmp, "foo_gate.md"),
        `---\ntype: gate\nchoices:\n  - Yes\n  - No\n---\nPick a choice`,
      );
      const handler = new WaitHumanHandler(makeInterviewer("Yes"), tmp);
      const node: Node = { id: "foo_gate" };
      const ctx: PipelineContext = { values: {} };
      const outcome = await handler.execute(node, ctx, { outgoingLabels: [] });
      expect(outcome.status).toBe("success");
      expect(outcome.preferredLabel).toBe("Yes");
      expect(outcome.contextUpdates).toEqual({
        "foo_gate.choice": "Yes",
        choice: "Yes",
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("prompt is variable-expanded from .md body", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-gate-test-"));
    try {
      writeFileSync(
        join(tmp, "approve_gate.md"),
        `---\ntype: gate\nchoices:\n  - Yes\n  - No\n---\nApprove $plan_path?`,
      );
      const captured: Question[] = [];
      const interviewer: Interviewer = {
        ask: async (q: Question): Promise<Answer> => {
          captured.push(q);
          return { value: "Yes" };
        },
      };
      const handler = new WaitHumanHandler(interviewer, tmp);
      const node: Node = { id: "approve_gate" };
      const ctx: PipelineContext = { values: { plan_path: "/p/foo.md" } };
      await handler.execute(node, ctx, { outgoingLabels: [] });
      expect(captured[0].prompt).toBe("Approve /p/foo.md?");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("choices come from frontmatter, not edge labels", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-gate-test-"));
    try {
      writeFileSync(
        join(tmp, "pick_gate.md"),
        `---\ntype: gate\nchoices:\n  - A\n  - B\n  - C\n---\nPick one`,
      );
      const captured: Question[] = [];
      const interviewer: Interviewer = {
        ask: async (q: Question): Promise<Answer> => {
          captured.push(q);
          return { value: "A" };
        },
      };
      const handler = new WaitHumanHandler(interviewer, tmp);
      const node: Node = { id: "pick_gate" };
      await handler.execute(node, { values: {} }, { outgoingLabels: ["X", "Y"] });
      expect(captured[0].options).toEqual(["A", "B", "C"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("missing .md → fail with Gate file not found", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-gate-test-"));
    try {
      const handler = new WaitHumanHandler(makeInterviewer("Yes"), tmp);
      const node: Node = { id: "missing_gate" };
      const outcome = await handler.execute(node, { values: {} }, { outgoingLabels: [] });
      expect(outcome.status).toBe("fail");
      expect(outcome.failureReason).toMatch(/Gate file not found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no label and no dotDir → fail with no dotDir message", async () => {
    const interviewer = makeInterviewer("Yes");
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = { id: "bare_gate" };
    const outcome = await handler.execute(node, { values: {} }, { outgoingLabels: [] });
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/no dotDir/);
  });

  it("regression: inline label still works when dotDir provided", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-gate-test-"));
    try {
      const captured: Question[] = [];
      const interviewer: Interviewer = {
        ask: async (q: Question): Promise<Answer> => {
          captured.push(q);
          return { value: "continue" };
        },
      };
      const handler = new WaitHumanHandler(interviewer, tmp);
      const node: Node = { id: "my_gate", label: "Continue?" };
      await handler.execute(node, { values: {} }, { outgoingLabels: ["continue"] });
      expect(captured[0].prompt).toBe("Continue?");
      expect(captured[0].options).toEqual(["continue"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
