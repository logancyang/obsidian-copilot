import { FileSystemAdapter, type App } from "obsidian";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import { joinPosix } from "@/utils/pathUtils";
import type { BuiltinSeedFs } from "./seedBuiltinSkills";

export function buildBuiltinSeedFs(app: App): BuiltinSeedFs {
  const adapter = app.vault.adapter;
  return {
    exists: (p) => adapter.exists(p),
    read: (p) => adapter.read(p),
    write: (p, c) => adapter.write(p, c),
    mkdir: (p) => adapter.mkdir(p),
    removeDir: async (p) => {
      // A symlinked directory belongs to its target: unlink it without walking into it. https://github.com/logancyang/obsidian-copilot/issues/3022
      if (adapter instanceof FileSystemAdapter && isDesktopRuntime()) {
        const fs = requireNodeModule<typeof import("node:fs")>("fs");
        if ((await fs.promises.lstat(adapter.getFullPath(p))).isSymbolicLink()) {
          await adapter.rmdir(p, true);
          return;
        }
      }
      // Keep SKILL.md (the ownership evidence) until every child is gone so retries stay safe.
      // https://github.com/logancyang/obsidian-copilot/issues/3022
      const contents = await adapter.list(p);
      for (const folder of contents.folders) await adapter.rmdir(folder, true);
      for (const file of contents.files) {
        if (file !== joinPosix(p, "SKILL.md")) await adapter.remove(file);
      }
      await adapter.rmdir(p, true);
    },
  };
}
