import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Scheduler } from "../scheduler";
import type { Task } from "../state";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "meditate:proj",
    command: "meditate",
    args: ["/path"],
    interval: 1,
    status: "active",
    createdAt: Date.now(),
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  };
}

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new Scheduler();
  });

  afterEach(() => {
    scheduler.destroy();
    vi.useRealTimers();
  });

  it("fires onFire after interval ms", () => {
    const fired: Task[] = [];
    scheduler.register(makeTask({ interval: 5 }), (t) => fired.push(t));
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fired).toHaveLength(1);
  });

  it("fires repeatedly", () => {
    const fired: Task[] = [];
    scheduler.register(makeTask({ interval: 5 }), (t) => fired.push(t));
    vi.advanceTimersByTime(5 * 60 * 1000 * 3);
    expect(fired).toHaveLength(3);
  });

  it("unregister stops firing", () => {
    const fired: Task[] = [];
    scheduler.register(makeTask(), (t) => fired.push(t));
    scheduler.unregister("meditate:proj");
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(fired).toHaveLength(0);
  });

  it("pause stops firing without removing", () => {
    const fired: Task[] = [];
    scheduler.register(makeTask({ interval: 5 }), (t) => fired.push(t));
    scheduler.pause("meditate:proj");
    vi.advanceTimersByTime(5 * 60 * 1000 * 3);
    expect(fired).toHaveLength(0);
  });

  it("resume restarts firing after pause", () => {
    const fired: Task[] = [];
    scheduler.register(makeTask({ interval: 5 }), (t) => fired.push(t));
    scheduler.pause("meditate:proj");
    scheduler.resume("meditate:proj");
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fired).toHaveLength(1);
  });

  it("destroy clears all timers", () => {
    const fired: Task[] = [];
    scheduler.register(makeTask(), (t) => fired.push(t));
    scheduler.destroy();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(fired).toHaveLength(0);
  });

  it("getNextRunAt returns approximate next fire time", () => {
    scheduler.register(makeTask({ interval: 5 }), () => {});
    const next = scheduler.getNextRunAt("meditate:proj");
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now());
  });

  it("skips onFire when guard returns true (skip-if-running)", () => {
    const fired: Task[] = [];
    let blocked = true;
    scheduler.register(
      makeTask({ interval: 5 }),
      (t) => fired.push(t),
      () => blocked,
    );
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fired).toHaveLength(0); // guard blocked it
    blocked = false;
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fired).toHaveLength(1); // guard allows it
  });
});
