import { requireNodeModule } from "@/utils/desktopRuntime";

const LOCKED_PATH_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RETRY_DELAY_MS = 200;

export async function renameWithRetry(from: string, to: string, timeoutMs = 600): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // Only a file another program holds open clears by waiting, and Windows reports it with these codes. https://github.com/logancyang/obsidian-copilot/issues/3822
      if (!code || !LOCKED_PATH_CODES.has(code) || Date.now() >= deadline) throw e;
      await new Promise((r) => window.setTimeout(r, RETRY_DELAY_MS));
    }
  }
}
