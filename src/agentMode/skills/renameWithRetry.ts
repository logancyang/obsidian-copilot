import { requireNodeModule } from "@/utils/desktopRuntime";

export async function renameWithRetry(from: string, to: string): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => window.setTimeout(r, 200));
    }
  }
  throw lastErr;
}
