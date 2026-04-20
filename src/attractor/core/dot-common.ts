import type { Node } from "../types.js";

// Convert snake_case to camelCase
export function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Convert attribute value string to typed value
export function coerceValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  const n = Number(val);
  if (!isNaN(n) && val.trim() !== "") return n;
  return val;
}

// Unescape DOT escape sequences inside double-quoted attribute values
export function unescapeDotString(s: string): string {
  return s.replace(/\\(.)/g, (_, ch) => {
    switch (ch) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case '"': return '"';
      case "\\": return "\\";
      default: return ch;
    }
  });
}

// Parse the model_stylesheet block into a simple structure
export function parseStylesheet(css: string): Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }> {
  const rules: Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }> = [];
  const ruleRe = /([^\{]+)\{([^\}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectorRaw = m[1].trim();
    const body = m[2];
    const props: Record<string, string> = {};
    const propRe = /([\w_-]+)\s*:\s*([^\s;]+)/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(body)) !== null) {
      props[toCamel(pm[1])] = pm[2].replace(/['"]/g, "");
    }
    let selectorType: "shape" | "class" | "id" | "universal";
    let selector = selectorRaw;
    if (selectorRaw === "*") { selectorType = "universal"; }
    else if (selectorRaw.startsWith(".")) { selectorType = "class"; selector = selectorRaw.slice(1); }
    else if (selectorRaw.startsWith("#")) { selectorType = "id"; selector = selectorRaw.slice(1); }
    else { selectorType = "shape"; }
    rules.push({ selector, selectorType, props });
  }
  return rules;
}

// Apply stylesheet rules to a node (lowest specificity first, explicit attrs win)
export function applyStylesheet(
  node: Node,
  rules: Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }>
): Node {
  const specificity = (t: string) =>
    t === "universal" ? 0 : t === "shape" ? 1 : t === "class" ? 2 : 3;
  const sorted = [...rules].sort((a, b) => specificity(a.selectorType) - specificity(b.selectorType));
  const resolved: Record<string, string> = {};
  for (const rule of sorted) {
    const matches =
      (rule.selectorType === "universal") ||
      (rule.selectorType === "shape" && node.shape === rule.selector) ||
      (rule.selectorType === "class" && node.class === rule.selector) ||
      (rule.selectorType === "id" && node.id === rule.selector);
    if (matches) Object.assign(resolved, rule.props);
  }
  return { ...resolved, ...node };
}

export function parseInputsAttr(raw: unknown): string[] | undefined {
  if (typeof raw !== "string") return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.length > 0 ? out : undefined;
}
