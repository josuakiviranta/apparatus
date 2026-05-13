import { spawn } from "node:child_process";

// caffeinate is built into macOS; on a stripped-down VM where it's missing,
// spawn emits an 'error' event asynchronously. Without a listener, Node
// crashes the engine on unhandled-error. We attach a noop listener so the
// pipeline keeps running, sleep-vulnerable.
export function preventSleep(): void {
  if (process.platform === "darwin") {
    const child = spawn("caffeinate", ["-is", "-w", String(process.pid)], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
    return;
  }
  // TODO(linux): systemd-inhibit --what=sleep --who=apparat --why="pipeline run" \
  //              --mode=block sleep infinity (detached + unref).
  // TODO(win32): SetThreadExecutionState via native binding or noop.
}
