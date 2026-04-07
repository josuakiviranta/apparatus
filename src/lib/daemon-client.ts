// src/lib/daemon-client.ts
import net from "net";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { existsSync } from "fs";
import { spawn } from "child_process";
import { homedir } from "os";

const SOCK_PATH = join(process.env.HOME || homedir(), ".ralph", "daemon.sock");
const DAEMON_START_TIMEOUT_MS = 3000;
const DAEMON_POLL_INTERVAL_MS = 100;

function getDaemonBin(): { command: string; args: string[] } {
  if (typeof __RALPH_PROD__ !== "undefined") {
    // prod: code may be in dist/cli/index.js or dist/chunk-*.js (tsup chunking)
    // Walk up from __dirname until we find a dir containing daemon/index.js
    let dir = __dirname;
    for (let i = 0; i < 3; i++) {
      const candidate = join(dir, "daemon", "index.js");
      if (existsSync(candidate)) {
        return { command: process.execPath, args: [candidate] };
      }
      dir = join(dir, "..");
    }
    // Fallback: assume dist/cli/ layout
    return { command: process.execPath, args: [join(__dirname, "..", "daemon", "index.js")] };
  }
  // dev mode — __dirname is somewhere in src/
  return { command: "tsx", args: [join(__dirname, "..", "daemon", "index.ts")] };
}

async function waitForSocket(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(SOCK_PATH)) return;
    await new Promise((r) => setTimeout(r, DAEMON_POLL_INTERVAL_MS));
  }
  throw new Error("Daemon failed to start — check permissions on ~/.ralph/");
}

async function ensureDaemon(): Promise<void> {
  if (existsSync(SOCK_PATH)) return;
  console.error("Starting ralph daemon...");
  const { command, args } = getDaemonBin();
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
  await waitForSocket(DAEMON_START_TIMEOUT_MS);
}

function openSocket(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCK_PATH);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export async function request(action: string, payload: object = {}): Promise<any> {
  await ensureDaemon();
  const socket = await openSocket();
  return new Promise((resolve, reject) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx === -1) return;
      try {
        const msg = JSON.parse(buf.slice(0, idx));
        socket.destroy();
        if (msg.type === "error") reject(new Error(msg.message));
        else resolve(msg);
      } catch (e) {
        reject(e);
      }
    });
    socket.on("error", reject);
    socket.write(JSON.stringify({ action, ...payload }) + "\n");
  });
}

export async function stream(
  action: string,
  payload: object,
  onData: (msg: any) => void,
  signal?: AbortSignal
): Promise<void> {
  await ensureDaemon();
  const socket = await openSocket();
  return new Promise((resolve, reject) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try { onData(JSON.parse(line)); } catch {}
      }
    });
    socket.on("error", reject);
    socket.on("close", resolve);
    signal?.addEventListener("abort", () => { socket.destroy(); resolve(); });
    socket.write(JSON.stringify({ action, ...payload }) + "\n");
  });
}
