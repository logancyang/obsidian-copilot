import {
  spawn,
  type SpawnOptionsWithoutStdio,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import * as path from "node:path";
import { existsSync } from "node:fs";
export function grokCliNeedsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}
export function antigravitySettingsPaths(home: string, env: NodeJS.ProcessEnv): string[] {
  const direct =
    path.basename(home) === ".gemini" ||
    existsSync(path.join(home, "antigravity-cli")) ||
    existsSync(path.join(home, "settings.json"));
  const base = env.GEMINI_HOME || (direct ? home : path.join(home, ".gemini"));
  return [path.join(base, "antigravity-cli", "settings.json"), path.join(base, "settings.json")];
}

export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams {
  const shim = grokCliNeedsShell(command);
  const quote = (value: string) =>
    '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1") + '"';
  const line = [command, ...args].map(quote).join(" ");
  return spawn(
    shim ? process.env.COMSPEC || "cmd.exe" : command,
    shim ? ["/d", "/s", "/c", '"' + line + '"'] : args,
    { ...options, shell: false, windowsVerbatimArguments: shim }
  );
}
