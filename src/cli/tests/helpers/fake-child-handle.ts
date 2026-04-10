import type { ChildHandle } from "../../lib/agent.js";
import type { StreamJsonEvent } from "../../lib/stream-formatter.js";

export interface FakeChildHandleController {
  handle: ChildHandle;
  emit(event: StreamJsonEvent): void;
  endStream(): void;
  submitted: string[];
  endCalled: boolean;
  killSignal: NodeJS.Signals | null;
  exitWith(code: number | null, stderrTail?: string): void;
}

export function createFakeChildHandle(sessionId = "fake-uuid"): FakeChildHandleController {
  const submitted: string[] = [];
  let endCalled = false;
  let killSignal: NodeJS.Signals | null = null;
  type ExitInfo = { code: number | null; signal: NodeJS.Signals | null; stderrTail: string };
  let resolveExit: (r: ExitInfo) => void;
  const exited = new Promise<ExitInfo>((res) => {
    resolveExit = res;
  });

  // Pending deliveries + pending awaiters for the async iterator
  const pending: StreamJsonEvent[] = [];
  const awaiters: Array<(v: IteratorResult<StreamJsonEvent>) => void> = [];
  let streamEnded = false;

  const events: AsyncIterable<StreamJsonEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<StreamJsonEvent>> {
          if (pending.length > 0) {
            return Promise.resolve({ value: pending.shift()!, done: false });
          }
          if (streamEnded) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise((resolve) => {
            awaiters.push(resolve);
          });
        },
      };
    },
  };

  const controller: FakeChildHandleController = {
    handle: {
      events: events as any,
      submit: async (text: string) => {
        submitted.push(text);
      },
      end: async () => {
        endCalled = true;
        resolveExit!({ code: 0, signal: null, stderrTail: "" });
      },
      kill: async (sig: NodeJS.Signals = "SIGTERM") => {
        killSignal = sig;
        resolveExit!({ code: null, signal: sig, stderrTail: "" });
      },
      sessionId,
      exited,
    },
    emit(event) {
      if (awaiters.length > 0) {
        awaiters.shift()!({ value: event, done: false });
      } else {
        pending.push(event);
      }
    },
    endStream() {
      streamEnded = true;
      while (awaiters.length > 0) {
        awaiters.shift()!({ value: undefined as any, done: true });
      }
    },
    get submitted() { return submitted; },
    get endCalled() { return endCalled; },
    get killSignal() { return killSignal; },
    exitWith(code, stderrTail = "") {
      resolveExit!({ code, signal: null, stderrTail });
    },
  };

  return controller;
}
