import { detectBinary } from "@/utils/detectBinary";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { resolveOpencodeBinary } from "./opencodeBinaryResolver";

/**
 * Run an auto-detect for an externally-installed `opencode`, ignoring any
 * stale custom-path override (e.g. a POSIX path synced from a macOS profile
 * onto Windows). Walks well-known native-install layouts (`~/.opencode/bin`,
 * `~/.bun/bin`, `~/.local/bin`, `%LOCALAPPDATA%\opencode\bin`, ProgramFiles)
 * plus the shared node-tool dirs, then falls back to a PATH walk via
 * `detectBinary` so users with a non-standard install dir on PATH still match.
 * Independent of the managed binary.
 *
 * Lives here rather than in `descriptor.ts` so `OpencodeBinaryManager` can call
 * it: the descriptor already imports the manager, so a manager→descriptor
 * import would close a cycle. The manager owns the adopt-existing flow, which
 * needs this detect inside its single-flight boundary.
 */
export async function detectOpencodeCliPath(): Promise<string | null> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const fromResolver = resolveOpencodeBinary({
    override: undefined,
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  });
  if (fromResolver) return fromResolver;
  return detectBinary("opencode");
}
