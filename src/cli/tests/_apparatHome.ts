import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface FakeApparatHome {
  path: string;
  cleanup: () => void;
}

export function withFakeApparatHome(label = "apparat-test-home"): FakeApparatHome {
  const path = mkdtempSync(join(tmpdir(), `${label}-`));
  const orig = process.env.APPARAT_HOME;
  process.env.APPARAT_HOME = path;
  return {
    path,
    cleanup: () => {
      if (orig === undefined) delete process.env.APPARAT_HOME;
      else process.env.APPARAT_HOME = orig;
      rmSync(path, { recursive: true, force: true });
    },
  };
}
