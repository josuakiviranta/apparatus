import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { createProgram } from "../program";

function findCommand(program: Command, name: string): Command | undefined {
  for (const cmd of program.commands) {
    if (cmd.name() === name) return cmd;
    const nested = findCommand(cmd, name);
    if (nested) return nested;
  }
  return undefined;
}

function optionFlags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "").filter(Boolean);
}

// TODO(parallel-impl): switch to describe(...) after chunks c1-c4 merge.
// The unified positional shape this suite asserts is delivered across sibling
// chunks c1 (implement), c2 (meditate), c3/c4 (pipeline run). On the base SHA
// shared by the parallel batch this suite would be red by design, so it ships
// as `describe.skip` and the orchestrator's post-merge full-suite run flips it
// back to `describe` once c1-c4 land.
describe.skip("pipeline shape parity — apparat <pipeline> <project>", () => {
  const program = createProgram();

  it("`implement` has exactly one positional arg and no --max/--scenarios options", () => {
    const cmd = findCommand(program, "implement");
    expect(cmd).toBeDefined();
    // Commander stores positional args on the underscore-prefixed _args array.
    const args = (cmd as unknown as { _args: Array<{ name: () => string; required: boolean }> })._args;
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe("project-folder");
    expect(args[0].required).toBe(true);

    const flags = optionFlags(cmd!);
    expect(flags).not.toContain("--max");
    expect(flags).not.toContain("--scenarios");
  });

  it("`meditate` has exactly one positional arg plus --steer and --var options", () => {
    const cmd = findCommand(program, "meditate");
    expect(cmd).toBeDefined();
    const args = (cmd as unknown as { _args: Array<{ name: () => string; required: boolean }> })._args;
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe("project-folder");
    expect(args[0].required).toBe(true);

    const flags = optionFlags(cmd!);
    expect(flags).toContain("--steer");
    expect(flags).toContain("--var");
  });

  it("`pipeline run` accepts <pipeline> as required and [project] as optional positional", () => {
    const cmd = findCommand(program, "run");
    expect(cmd).toBeDefined();
    const args = (cmd as unknown as { _args: Array<{ name: () => string; required: boolean }> })._args;
    expect(args).toHaveLength(2);
    expect(args[0].name()).toBe("pipeline");
    expect(args[0].required).toBe(true);
    expect(args[1].name()).toBe("project");
    expect(args[1].required).toBe(false);

    const flags = optionFlags(cmd!);
    // --project is kept as a deprecated alias; assert presence + description mentions "deprecated".
    expect(flags).toContain("--project");
    const projectOpt = cmd!.options.find((o) => o.long === "--project");
    expect(projectOpt?.description.toLowerCase()).toMatch(/deprecated/);
  });
});
