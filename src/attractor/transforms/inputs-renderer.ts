import { resolveInputDecl } from "./inputs-resolver.js";

/**
 * Render the auto-injected Inputs block for an agent call.
 * Section header is `## Inputs\n\n`. Each declared input becomes a tagged
 * block: `<renderedTag>value</renderedTag>` (single line for short values
 * with no newlines; tag/value/closing-tag on separate lines for multi-line
 * values to keep each block visually scannable).
 */
export function renderInputsBlock(
  inputs: string[],
  ctxValues: Record<string, unknown>,
  nodeDefaults: Record<string, unknown>,
): string {
  const lines: string[] = ["## Inputs", ""];
  for (const decl of inputs) {
    const r = resolveInputDecl(decl);
    let rawValue: unknown;
    if (Object.prototype.hasOwnProperty.call(ctxValues, r.lookupKey)) {
      rawValue = ctxValues[r.lookupKey];
    } else if (Object.prototype.hasOwnProperty.call(nodeDefaults, r.fallbackAttr)) {
      rawValue = nodeDefaults[r.fallbackAttr];
    } else {
      throw new Error(
        `renderInputsBlock: missing input "${r.name}" — not in ctx.values ` +
        `and no node default "${r.fallbackAttr}"`,
      );
    }
    const stringValue = rawValue == null ? "" : String(rawValue);
    if (stringValue.includes("\n")) {
      lines.push(`<${r.renderedTag}>`);
      lines.push(stringValue);
      lines.push(`</${r.renderedTag}>`);
      lines.push("");
    } else {
      lines.push(`<${r.renderedTag}>${stringValue}</${r.renderedTag}>`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
