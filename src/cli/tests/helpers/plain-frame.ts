const ANSI_RE = /\u001B\[[0-9;]*m/g;

export function plainFrame(frame: string | null | undefined): string {
  return (frame ?? "").replace(ANSI_RE, "");
}
