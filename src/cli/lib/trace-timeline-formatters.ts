/**
 * Per-tool input formatters for the cross-node trace timeline view.
 * Pure — no IO. One function per known tool; default falls back to
 * a truncated JSON.stringify. See design doc §3.2.
 */

const MAX_SUMMARY = 60;

function truncateMiddle(s: string, max = MAX_SUMMARY): string {
  if (s.length <= max) return s;
  const keep = max - 1; // room for one ellipsis char
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return s.slice(0, head) + "…" + s.slice(s.length - tail);
}

function truncateTail(s: string, max = MAX_SUMMARY): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function countLines(s: unknown): number {
  if (typeof s !== "string") return 0;
  if (s.length === 0) return 0;
  return s.split("\n").length;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

type Input = Record<string, unknown> | undefined | null;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function summarizeRead(input: Input): string {
  return truncateMiddle(asString(input?.file_path));
}

function summarizeEdit(input: Input): string {
  const path = asString(input?.file_path);
  const oldLines = countLines(input?.old_string);
  const newLines = countLines(input?.new_string);
  return `${truncateMiddle(path, MAX_SUMMARY - 10)} -${oldLines}+${newLines}`;
}

function summarizeWrite(input: Input): string {
  const path = asString(input?.file_path);
  const content = asString(input?.content);
  return `${truncateMiddle(path, MAX_SUMMARY - 10)} ${formatBytes(Buffer.byteLength(content, "utf8"))}`;
}

function summarizeBash(input: Input): string {
  const cmd = asString(input?.command).replace(/\s+/g, " ").trim();
  return truncateTail(cmd);
}

function summarizeGrep(input: Input): string {
  const pattern = asString(input?.pattern);
  const path = asString(input?.path) || ".";
  return truncateTail(`${pattern} in ${path}`);
}

function summarizeAgent(input: Input): string {
  const desc = asString(input?.description);
  return truncateMiddle(`▶ ${desc}`);
}

export function summarizeToolInput(toolName: string, input: unknown): string {
  const inp = (input && typeof input === "object") ? (input as Record<string, unknown>) : null;
  switch (toolName) {
    case "Read":  return summarizeRead(inp);
    case "Edit":  return summarizeEdit(inp);
    case "Write": return summarizeWrite(inp);
    case "Bash":  return summarizeBash(inp);
    case "Grep":  return summarizeGrep(inp);
    case "Agent": return summarizeAgent(inp);
    default:      return truncateTail(JSON.stringify(input ?? null));
  }
}
