import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import { requireNodeModule } from "@/utils/desktopRuntime";

function realPath(fs: typeof import("node:fs"), target: string): string | null {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

function writesOnlyItself(fs: typeof import("node:fs"), target: string): boolean {
  try {
    const entry = fs.lstatSync(target, { throwIfNoEntry: false });
    return entry === undefined || (entry.isFile() && entry.nlink === 1);
  } catch {
    return false;
  }
}

// A write skips the permission card only for the agent's own MEMORY.md while custom agents are available, so the path a model wrote is compared by where it really lands: through symlinked folders and "..", never through a link at the file itself.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/942
export function isAgentMemoryFile(requestedPath: string, memoryPath: string): boolean {
  if (getCustomAgentsGate() !== "full") return false;
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  if (!path.isAbsolute(requestedPath) || !writesOnlyItself(fs, requestedPath)) return false;
  const folder = realPath(fs, path.dirname(memoryPath));
  const requestedFolder = realPath(fs, path.dirname(requestedPath));
  if (!folder || !requestedFolder) return false;
  return (
    path.join(requestedFolder, path.basename(requestedPath)) ===
    path.join(folder, path.basename(memoryPath))
  );
}
