import { FileSystemAdapter, type App } from "obsidian";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import { joinPosix } from "@/utils/pathUtils";
import type { BuiltinSeedFs } from "./seedBuiltinSkills";

/** Adapt vault storage for built-in reconciliation.
 * @param app - Vault whose managed skill files are being reconciled.
 */
export function buildBuiltinSeedFs(app: App): BuiltinSeedFs {
  const adapter = app.vault.adapter;
  return {
    exists: (p) => adapter.exists(p),
    read: (p) => adapter.read(p),
    write: (p, c) => adapter.write(p, c),
    mkdir: (p) => adapter.mkdir(p),
    removeDir: async (p) => {
      // A linked canonical directory belongs to its target; unlink it without
      // walking into external files. https://github.com/logancyang/obsidian-copilot/issues/3022
      if (adapter instanceof FileSystemAdapter && isDesktopRuntime()) {
        const fs = requireNodeModule<typeof import("node:fs")>("fs");
        if ((await fs.promises.lstat(adapter.getFullPath(p))).isSymbolicLink()) {
          await adapter.rmdir(p, true);
          return;
        }
      }
      // Recursive deletion can remove SKILL.md before hitting an unreadable child.
      // Keep ownership evidence until every child is gone so retries remain safe.
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
