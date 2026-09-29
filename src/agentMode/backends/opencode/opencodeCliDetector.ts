import { detectBinary } from "@/utils/detectBinary";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { resolveOpencodeBinary } from "./opencodeBinaryResolver";

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
