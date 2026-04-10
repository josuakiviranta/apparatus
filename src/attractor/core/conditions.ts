import type { Outcome } from "../types.js";

type ContextMap = Record<string, unknown>;

function resolveKey(key: string, outcome: Outcome, ctx: ContextMap): string {
  if (key === "outcome") return outcome.status;
  if (key === "preferred_label") return outcome.preferredLabel ?? "";
  if (key.startsWith("context.")) {
    const v = ctx[key] ?? ctx[key.slice(8)];
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  }
  return "";
}

function evaluateClause(clause: string, outcome: Outcome, ctx: ContextMap): boolean {
  clause = clause.trim();
  const neq = clause.indexOf("!=");
  const eq  = clause.indexOf("=");

  if (neq !== -1) {
    const key = clause.slice(0, neq).trim();
    const val = clause.slice(neq + 2).trim().replace(/^'|'$/g, "");
    return resolveKey(key, outcome, ctx) !== val;
  } else if (eq !== -1) {
    const key = clause.slice(0, eq).trim();
    const val = clause.slice(eq + 1).trim().replace(/^'|'$/g, "");
    return resolveKey(key, outcome, ctx) === val;
  }
  return true;
}

export function evaluateCondition(condition: string, outcome: Outcome, ctx: ContextMap): boolean {
  if (!condition || condition.trim() === "") return true;
  const clauses = condition.split("&&");
  return clauses.every(c => evaluateClause(c, outcome, ctx));
}
