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
  const v = ctx[key];
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export type ConditionClause = { key: string; op: "=" | "!="; val: string };

export function parseConditionClauses(condition: string): ConditionClause[] {
  if (!condition || condition.trim() === "") return [];
  const out: ConditionClause[] = [];
  for (const raw of condition.split("&&")) {
    const clause = raw.trim();
    if (clause === "") continue;
    const neq = clause.indexOf("!=");
    const eq = clause.indexOf("=");
    if (neq !== -1) {
      out.push({
        key: clause.slice(0, neq).trim(),
        op: "!=",
        val: clause.slice(neq + 2).trim().replace(/^'|'$/g, ""),
      });
    } else if (eq !== -1) {
      out.push({
        key: clause.slice(0, eq).trim(),
        op: "=",
        val: clause.slice(eq + 1).trim().replace(/^'|'$/g, ""),
      });
    }
  }
  return out;
}

function evaluateClause(clause: ConditionClause, outcome: Outcome, ctx: ContextMap): boolean {
  const actual = resolveKey(clause.key, outcome, ctx);
  return clause.op === "!=" ? actual !== clause.val : actual === clause.val;
}

export function evaluateCondition(condition: string, outcome: Outcome, ctx: ContextMap): boolean {
  if (!condition || condition.trim() === "") return true;
  const clauses = parseConditionClauses(condition);
  if (clauses.length === 0) return true;
  return clauses.every(c => evaluateClause(c, outcome, ctx));
}
