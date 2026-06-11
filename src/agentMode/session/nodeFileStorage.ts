import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { AgentSessionIndexStorage } from "./AgentSessionIndex";

/**
 * `AgentSessionIndexStorage` backed by Node's filesystem, for storing the
 * agent session index OUTSIDE the vault (under `~/.obsidian-copilot/`). The
 * index mirrors device-local backend stores (`~/.claude/projects`, opencode's
 * own session dirs) and references session ids that only resolve on the
 * machine that created them, so it must not ride vault sync — keeping it in
 * the OS app-data dir, beside the runtimes it tracks, avoids ghost entries and
 * sync conflicts on other devices. Desktop-only, matching Agent Mode.
 */
export function createNodeFileStorage(): AgentSessionIndexStorage {
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
