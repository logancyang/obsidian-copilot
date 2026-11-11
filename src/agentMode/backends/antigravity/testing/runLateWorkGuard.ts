import { requireNodeModule } from "@/utils/desktopRuntime";

export interface LateWorkGuardRun {
  output: unknown;
  sleptSeconds: string[];
}

export function runLateWorkGuard(
  vault: string,
  branch: "deny" | "stop",
  hookInput: Record<string, unknown>,
  copilotAcp: string | undefined
): LateWorkGuardRun {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const { spawnSync } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const shimDir = fs.mkdtempSync(path.join(path.dirname(vault), "sleep-shim-"));
  const sleepLog = path.join(shimDir, "slept");
  fs.writeFileSync(path.join(shimDir, "sleep"), `#!/bin/sh\necho "$1" >> '${sleepLog}'\n`, {
    mode: 0o755,
  });
  const env: NodeJS.ProcessEnv = { PATH: `${shimDir}:/usr/bin:/bin` };
  if (copilotAcp !== undefined) env.OBSIDIAN_COPILOT_ACP = copilotAcp;
  const result = spawnSync("sh", ["./copilot-guard.sh", branch], {
    cwd: path.join(vault, ".agent"),
    env,
    input: JSON.stringify(hookInput),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`guard exited ${result.status}: ${result.stderr}`);
  return {
    output: JSON.parse(result.stdout) as unknown,
    sleptSeconds: fs.existsSync(sleepLog)
      ? fs.readFileSync(sleepLog, "utf8").split("\n").filter(Boolean)
      : [],
  };
}
