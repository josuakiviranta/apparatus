import type { Task } from "./state";

interface Entry {
  task: Task;
  timer: NodeJS.Timeout | null;
  onFire: (task: Task) => void;
  isRunning?: () => boolean;
  registeredAt: number;
}

export class Scheduler {
  private entries = new Map<string, Entry>();

  register(
    task: Task,
    onFire: (task: Task) => void,
    isRunning?: () => boolean,
  ): void {
    this.unregister(task.id);
    const intervalMs = task.interval * 60 * 1000;
    const fire = () => {
      if (isRunning?.()) return; // skip-if-running guard
      onFire(task);
    };
    const entry: Entry = {
      task,
      onFire,
      isRunning,
      registeredAt: Date.now(),
      timer: setInterval(fire, intervalMs),
    };
    this.entries.set(task.id, entry);
  }

  unregister(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    if (entry.timer) clearInterval(entry.timer);
    this.entries.delete(taskId);
  }

  pause(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.timer) return;
    clearInterval(entry.timer);
    entry.timer = null;
  }

  resume(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry || entry.timer) return;
    const intervalMs = entry.task.interval * 60 * 1000;
    entry.registeredAt = Date.now();
    const fire = () => {
      if (entry.isRunning?.()) return;
      entry.onFire(entry.task);
    };
    entry.timer = setInterval(fire, intervalMs);
  }

  getNextRunAt(taskId: string): number | null {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.timer) return null;
    return entry.registeredAt + entry.task.interval * 60 * 1000;
  }

  destroy(): void {
    for (const id of this.entries.keys()) this.unregister(id);
  }
}
