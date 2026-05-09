// src/cli/commands/watch.ts
import { renderWatchApp } from "../components/WatchApp.js";

export async function watchCommand(): Promise<void> {
  await renderWatchApp();
}
