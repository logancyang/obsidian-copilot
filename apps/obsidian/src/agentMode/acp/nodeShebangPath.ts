import { detectionSearchDirs, mergePath } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

export function augmentPathForNodeShebang(
  binaryPath: string,
  inherited: string | undefined
): string {
  const path = requireNodeModule<typeof import("node:path")>("path");
  return mergePath([path.dirname(binaryPath), ...detectionSearchDirs()], inherited);
}
