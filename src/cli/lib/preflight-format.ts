export interface MissingInputsErrorInput {
  pipelineName: string;
  declared: string[];
  provided: Record<string, unknown>;
  missing: string[];
  invokedAs: string;
}

const HRULE = "────────────────────────────────────────";

export function formatMissingInputsError(input: MissingInputsErrorInput): string {
  const providedKeys = Object.keys(input.provided);
  const providedRendered = providedKeys.length === 0 ? "(none)" : providedKeys.join(", ");
  const lines: string[] = [];
  lines.push("PIPELINE ERROR: Missing required inputs");
  lines.push(HRULE);
  lines.push(`Pipeline:   ${input.pipelineName}`);
  lines.push(`Required:   ${input.declared.join(", ")}`);
  lines.push(`Provided:   ${providedRendered}`);
  lines.push("");
  lines.push("Missing:");
  for (const name of input.missing) lines.push(`  $${name}`);
  lines.push("");
  lines.push("Supply with:");
  const flags = input.missing.map((n) => `    --var ${n}=<${guessPlaceholder(n)}>`);
  lines.push(`  ralph pipeline run ${input.invokedAs} \\`);
  lines.push(flags.join(" \\\n"));
  return lines.join("\n");
}

export function formatLegacyMissingWarning(missing: string[]): string {
  const lines: string[] = [];
  lines.push("PIPELINE WARNING: Pipeline references variables not in the caller context");
  for (const n of missing) lines.push(`  $${n}`);
  lines.push("");
  lines.push("The pipeline does not declare `inputs=`, so this is a best-effort check.");
  lines.push("Proceeding anyway. If the run fails mid-pipeline, supply the variable with");
  lines.push(`\`--var ${missing[0]}=<value>\` or add \`inputs="..."\` to the DOT file.`);
  return lines.join("\n");
}

export function formatUndeclaredWarning(undeclared: string[]): string {
  const lines: string[] = [];
  lines.push("PIPELINE WARNING: Pipeline references variables not declared in `inputs=`");
  for (const n of undeclared) lines.push(`  $${n}`);
  lines.push("");
  lines.push("Either add these to the `inputs=` attribute or remove the references.");
  lines.push("Proceeding anyway.");
  return lines.join("\n");
}

function guessPlaceholder(name: string): string {
  if (name.endsWith("_path") || name.endsWith("Path")) return "path";
  if (name.endsWith("_dir") || name.endsWith("Dir")) return "path";
  if (name.endsWith("_file") || name.endsWith("File")) return "path";
  return "value";
}
