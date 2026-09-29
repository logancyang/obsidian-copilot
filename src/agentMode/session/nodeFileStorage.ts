import type { AgentSessionIndexStorage } from "./AgentSessionIndex";
import { requireNodeModule } from "@/utils/desktopRuntime";

export function createNodeFileStorage(): AgentSessionIndexStorage {
  const { mkdir, readFile, stat, writeFile } =
    requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return {
    exists: async (p) => {
      try {
        await stat(p);
        return true;
      } catch {
        return false;
      }
    },
    read: (p) => readFile(p, "utf8"),
    write: async (p, content) => {
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    },
  };
}
