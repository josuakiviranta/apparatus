import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../program";

describe("CLI command structure", () => {
  it("has a meditate command", () => {
    const program = createProgram();
    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    expect(meditateCmd).toBeDefined();
  });

  it("does NOT have a top-level meditate-create command", () => {
    const program = createProgram();
    const meditateCreateCmd = program.commands.find(
      (c) => c.name() === "meditate-create"
    );
    expect(meditateCreateCmd).toBeUndefined();
  });

  it("does NOT have a meditate create subcommand (deprecated)", () => {
    const program = createProgram();
    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    expect(meditateCmd).toBeDefined();
    const createCmd = meditateCmd!.commands.find((c) => c.name() === "create");
    expect(createCmd).toBeUndefined();
  });

  it("meditate has the correct description", () => {
    const program = createProgram();
    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    expect(meditateCmd).toBeDefined();
    expect(meditateCmd!.description()).toBe("Run a restricted Claude session that writes insights to meditations/illuminations/");
  });
});

describe("CLI parseAsync routing", () => {
  it("ralph meditate <folder> calls the meditate action with folder arg", async () => {
    const program = createProgram();
    program.exitOverride();

    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    const actionFn = vi.fn();
    meditateCmd!.action(actionFn);

    await program.parseAsync(["node", "ralph", "meditate", "./myproject"]);
    expect(actionFn).toHaveBeenCalled();
    expect(actionFn.mock.calls[0][0]).toBe("./myproject");
  });
});
