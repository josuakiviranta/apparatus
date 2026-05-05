import { describe, it, expect, vi } from "vitest";
import { AgentHandlerDispatch } from "../handlers/agent-dispatch.js";
import type { NodeHandler } from "../handlers/registry.js";
import type { Node } from "../types.js";

function makeStubHandler(label: string): NodeHandler {
  return {
    execute: vi.fn().mockResolvedValue({ status: "success", contextUpdates: { from: label } }),
  };
}

describe("AgentHandlerDispatch", () => {
  it("routes interactive=true (boolean) to interactive handler", async () => {
    const interactive = makeStubHandler("interactive");
    const looping = makeStubHandler("looping");
    const dispatch = new AgentHandlerDispatch(interactive, looping);
    const node: Node = { id: "n1", interactive: true };
    const out = await dispatch.execute(node, { values: {} }, {} as any);
    expect(interactive.execute).toHaveBeenCalledOnce();
    expect(looping.execute).not.toHaveBeenCalled();
    expect(out.contextUpdates).toEqual({ from: "interactive" });
  });

  it('routes interactive="true" (string, DOT-coerced) to interactive handler', async () => {
    const interactive = makeStubHandler("interactive");
    const looping = makeStubHandler("looping");
    const dispatch = new AgentHandlerDispatch(interactive, looping);
    const node: Node = { id: "n1", interactive: "true" };
    await dispatch.execute(node, { values: {} }, {} as any);
    expect(interactive.execute).toHaveBeenCalledOnce();
    expect(looping.execute).not.toHaveBeenCalled();
  });

  it("routes missing/false interactive to looping handler", async () => {
    const interactive = makeStubHandler("interactive");
    const looping = makeStubHandler("looping");
    const dispatch = new AgentHandlerDispatch(interactive, looping);
    await dispatch.execute({ id: "n1" } as Node, { values: {} }, {} as any);
    await dispatch.execute({ id: "n2", interactive: false } as Node, { values: {} }, {} as any);
    expect(interactive.execute).not.toHaveBeenCalled();
    expect(looping.execute).toHaveBeenCalledTimes(2);
  });
});
