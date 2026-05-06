import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import net from "net";
import { createSocketServer } from "../socket";
import type { RequestHandlers } from "../socket";

const testDir = join(tmpdir(), `apparat-socket-test-${process.pid}`);
const sockPath = join(testDir, "test.sock");

function makeHandlers(overrides: Partial<RequestHandlers> = {}): RequestHandlers {
  return {
    list_tasks: () => [],
    register_task: (command, args, interval) => ({
      id: `${command}:${args[0]}`,
      command, args, interval,
      status: "active" as const, createdAt: Date.now(), lastRunAt: null, nextRunAt: null,
    }),
    stop_task: () => {},
    pause_task: () => {},
    resume_task: () => {},
    kill_session: () => {},
    stream_logs: (_taskId, _follow, _onLine) => () => {},
    watch: (_onEvent) => () => {},
    ...overrides,
  };
}

async function sendRequest(msg: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sockPath);
    let buf = "";
    client.on("data", (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx !== -1) {
        try { resolve(JSON.parse(buf.slice(0, idx))); } catch (e) { reject(e); }
        client.destroy();
      }
    });
    client.on("error", reject);
    client.on("connect", () => client.write(JSON.stringify(msg) + "\n"));
  });
}

let server: net.Server;
beforeEach(async () => {
  mkdirSync(testDir, { recursive: true });
  server = createSocketServer(sockPath, makeHandlers());
  await new Promise<void>((res) => server.listen(sockPath, res));
});
afterEach(async () => {
  await new Promise<void>((res) => server.close(() => res()));
  rmSync(testDir, { recursive: true, force: true });
});

describe("socket server", () => {
  it("responds to list_tasks", async () => {
    const res = await sendRequest({ action: "list_tasks" });
    expect(res).toMatchObject({ type: "tasks", data: [] });
  });

  it("responds to register_task", async () => {
    const res = await sendRequest({
      action: "register_task",
      command: "meditate",
      args: ["/path"],
      interval: 5,
    });
    expect(res).toMatchObject({ type: "ok", taskId: "meditate:/path" });
  });

  it("returns error for unknown action", async () => {
    const res = await sendRequest({ action: "unknown_action" }) as any;
    expect(res.type).toBe("error");
    expect(res.message).toContain("Unknown action");
  });

  it("returns error for malformed JSON", async () => {
    const res = await new Promise<object>((resolve, reject) => {
      const client = net.createConnection(sockPath);
      let buf = "";
      client.on("data", (chunk) => {
        buf += chunk.toString();
        const idx = buf.indexOf("\n");
        if (idx !== -1) {
          try { resolve(JSON.parse(buf.slice(0, idx))); } catch (e) { reject(e); }
          client.destroy();
        }
      });
      client.on("error", reject);
      client.on("connect", () => client.write("not json\n"));
    });
    expect((res as any).type).toBe("error");
  });
});
