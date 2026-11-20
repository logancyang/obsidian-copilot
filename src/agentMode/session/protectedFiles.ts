import { requireNodeModule } from "@/utils/desktopRuntime";

// Whoever runs the chats can name a file, kept in each folder directly inside a folder, that no model may write, move or delete, with the reason the model is told.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/989
export interface ProtectedFiles {
  folder: string;
  fileName: string;
  reason: string;
}

// A write lands where the file system puts it: through "..", a symlinked folder or another letter case on macOS and Windows, and into folders that don't exist yet.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/989
export function isProtectedFile(rule: ProtectedFiles, target: string, cwd: string): boolean {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const file = landingPath(path.resolve(cwd, target)).toLowerCase();
  const folder = landingPath(path.resolve(rule.folder)).toLowerCase();
  return (
    path.basename(file) === rule.fileName.toLowerCase() &&
    path.dirname(path.dirname(file)) === folder
  );
}

function landingPath(absolute: string): string {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const missing: string[] = [];
  for (let current = absolute; ; current = path.dirname(current)) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing);
    } catch {
      if (path.dirname(current) === current) return absolute;
      missing.unshift(path.basename(current));
    }
  }
}
