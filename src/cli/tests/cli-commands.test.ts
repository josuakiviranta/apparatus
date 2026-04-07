import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../program";

describe("CLI command structure", () => {
  it("has a meditate command with a create subcommand", () => {
    const program = createProgram();
    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    expect(meditateCmd).toBeDefined();

    const createCmd = meditateCmd!.commands.find(
      (c) => c.name() === "create"
    );
    expect(createCmd).toBeDefined();
  });

  it("does NOT have a top-level meditate-create command", () => {
    const program = createProgram();
    const meditateCreateCmd = program.commands.find(
      (c) => c.name() === "meditate-create"
    );
    expect(meditateCreateCmd).toBeUndefined();
  });

  it("meditate does NOT have a kill subcommand", () => {
    const program = createProgram();
    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    expect(meditateCmd).toBeDefined();

    const killCmd = meditateCmd!.commands.find((c) => c.name() === "kill");
    expect(killCmd).toBeUndefined();
  });

  it("meditate parent command has the correct description", () => {
    const program = createProgram();
    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    expect(meditateCmd).toBeDefined();
    expect(meditateCmd!.description()).toBe("Run a restricted Claude session that writes insights to meditations/illuminations/");
  });

  it("meditate create subcommand has the correct description", () => {
    const program = createProgram();
    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    expect(meditateCmd).toBeDefined();

    const createCmd = meditateCmd!.commands.find(
      (c) => c.name() === "create"
    );
    expect(createCmd).toBeDefined();
    expect(createCmd!.description()).toBe("Create a new meditation script with a guided Claude session");
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

  it("ralph meditate create <folder> calls the create subcommand action with folder arg", async () => {
    const program = createProgram();
    program.exitOverride();

    const meditateCmd = program.commands.find((c) => c.name() === "meditate");
    const createCmd = meditateCmd!.commands.find((c) => c.name() === "create");
    const actionFn = vi.fn();
    createCmd!.action(actionFn);

    await program.parseAsync([
      "node",
      "ralph",
      "meditate",
      "create",
      "./myproject",
    ]);
    expect(actionFn).toHaveBeenCalled();
    expect(actionFn.mock.calls[0][0]).toBe("./myproject");
  });
});
