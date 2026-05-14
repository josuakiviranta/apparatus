import { execSync } from "node:child_process";

/**
 * Fire an OS notification on macOS via osascript.
 * Silent no-op on Linux/Windows.
 * Notification failures never throw — banners must never break a pipeline run.
 */
export function notifyUser(title: string, body: string, subtitle?: string): void {
  if (process.platform !== "darwin") return;
  try {
    const escTitle = title.replace(/"/g, '\\"');
    const escBody = body.replace(/"/g, '\\"');
    const escSubtitle = subtitle?.replace(/"/g, '\\"');
    const subtitleClause = escSubtitle ? ` subtitle "${escSubtitle}"` : "";
    execSync(
      `osascript -e 'display notification "${escBody}" with title "${escTitle}"${subtitleClause}'`,
      { stdio: "ignore" },
    );
  } catch {
    // notification failure must never break a pipeline run
  }
}
