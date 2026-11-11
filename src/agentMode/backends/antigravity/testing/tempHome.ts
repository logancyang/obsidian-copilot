import { requireNodeModule } from "@/utils/desktopRuntime";

export interface TempHome {
  homeDir: string;
  installAgy(script?: string): string;
  restore(): void;
}

export function pinTempHome(): TempHome {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const previousHome = process.env.HOME;
  const homeDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-home-")));
  process.env.HOME = homeDir;
  jest.mocked(os.homedir).mockReturnValue(homeDir);
  return {
    homeDir,
    installAgy(script = "") {
      const binDir = path.join(homeDir, ".local", "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const agy = path.join(binDir, "agy");
      fs.writeFileSync(agy, `#!/bin/sh\n${script}`, { mode: 0o755 });
      return agy;
    },
    restore() {
      jest.mocked(os.homedir).mockReset();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      fs.rmSync(homeDir, { recursive: true, force: true });
    },
  };
}
