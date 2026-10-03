import { requestUrl } from "obsidian";
import type CopilotPlugin from "@/main";
import {
  getSettings,
  updateAgentModeBackendFields,
  type CompanionBackendId,
  type CompanionBackendSettings,
} from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary, validateExecutableFile } from "@/utils/detectBinary";
import {
  companionCompatibility,
  companionInvocation,
  type CompanionDefinition,
} from "@/agentMode/backends/shared/companionPolicy";
import { signInWithCli } from "@/agentMode/backends/shared/cliSignIn";
import type { BackendSignInHandlers } from "@/agentMode/session/types";

export async function resolveCompanionNode(env: NodeJS.ProcessEnv): Promise<string> {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const command = env.COMPANION_NODE_PATH || (await detectBinary("node"));
  if (!command || !/^node(?:\.exe)?$/i.test(path.basename(command)))
    throw new Error(
      "Companion adapters require Node.js 20 or later. Install Node.js and restart Obsidian, or set COMPANION_NODE_PATH in this backend's environment overrides."
    );
  const error = await validateExecutableFile(command);
  if (error) throw new Error(error);
  const version = await runCompanionCommand(command, ["-p", "process.versions.node"], env);
  if (!/^\d+\.\d+\.\d+$/.test(version) || Number(version.split(".")[0]) < 20)
    throw new Error(
      "Companion adapters require Node.js 20 or later. Update Node.js and restart Obsidian."
    );
  return command;
}

export async function runCompanionCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeout = 15000,
  onOutput?: (chunk: string) => void
): Promise<string> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const invocation = companionInvocation(command, args, process.platform, env.COMSPEC);
  return new Promise((resolve, reject) => {
    const child = execFile(
      invocation.command,
      invocation.args,
      { env, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stderr}`));
        else resolve(`${stdout}\n${stderr}`.trim());
      }
    );
    if (onOutput) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", onOutput);
      child.stderr?.on("data", onOutput);
    }
  });
}

export function companionEnvironment(
  id: CompanionBackendId,
  config: CompanionBackendSettings
): NodeJS.ProcessEnv {
  const env = { ...process.env, ...config.envOverrides };
  if (id === "muse" && process.platform !== "darwin" && env.TBH_CREDENTIAL_BACKEND === undefined)
    env.TBH_CREDENTIAL_BACKEND = "file";
  return env;
}

export async function detectCompanion(definition: CompanionDefinition): Promise<string | null> {
  const found = await detectBinary(definition.binaryName);
  if (found) return found;
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const home = os.homedir();
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".grok", "bin"),
    path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Programs", "muse"),
    path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "agy", "bin"),
  ];
  for (const dir of dirs)
    for (const suffix of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const candidate = path.join(dir, definition.binaryName + suffix);
      if (fs.existsSync(candidate)) return candidate;
    }
  return null;
}

export async function verifyCompanion(
  definition: CompanionDefinition,
  binaryPath: string
): Promise<string> {
  const error = await validateExecutableFile(binaryPath);
  if (error) throw new Error(error);
  const config = getSettings().agentMode.backends[definition.id] ?? {};
  const version = await runCompanionCommand(
    binaryPath,
    ["--version"],
    companionEnvironment(definition.id, config)
  );
  const incompatibility = companionCompatibility(definition.id, version, process.platform);
  if (incompatibility) throw new Error(incompatibility);
  return /\b\d+\.\d+\.\d+\b/.exec(version)![0];
}

export async function configureCompanion(
  definition: CompanionDefinition,
  binaryPath?: string
): Promise<string> {
  const configured = binaryPath ?? (await detectCompanion(definition));
  if (!configured)
    throw new Error(`${definition.displayName} CLI was not found. Install it or specify its path.`);
  const binaryVersion = await verifyCompanion(definition, configured);
  updateAgentModeBackendFields(definition.id, {
    binaryPath: configured,
    binaryVersion,
    binarySource: "custom",
  });
  return configured;
}

const installations = new Set<CompanionBackendId>();

export async function installCompanion(
  plugin: CopilotPlugin,
  definition: CompanionDefinition,
  onOutput?: (chunk: string) => void
): Promise<string> {
  if (installations.has(definition.id))
    throw new Error("Installation is already running for this backend.");
  installations.add(definition.id);
  const operation = async () => {
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const os = requireNodeModule<typeof import("node:os")>("os");
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "copilot-cli-install-"));
    try {
      const windows = process.platform === "win32";
      const response = await requestUrl({
        url: `${definition.installerBaseUrl}${windows ? ".ps1" : ".sh"}`,
      });
      const script = path.join(dir, windows ? "install.ps1" : "install.sh");
      await fs.promises.writeFile(script, response.text, "utf8");
      const output = await runCompanionCommand(
        windows ? "powershell.exe" : "bash",
        windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] : [script],
        process.env,
        600000,
        onOutput
      );
      const binaryPath = await configureCompanion(definition);
      return `${output}\nVerified ${binaryPath}`;
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  };
  try {
    let output = "";
    if (plugin.agentSessionManager)
      await plugin.agentSessionManager.restartBackend(definition.id, "CLI installation", {
        deferWhileBusy: false,
        maintenance: async () => {
          output = await operation();
        },
      });
    else output = await operation();
    return output;
  } finally {
    installations.delete(definition.id);
  }
}

export async function resolveCompanionAdapter(
  vaultBasePath: string,
  pluginDirectory: string,
  id: CompanionBackendId
): Promise<string> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const file = path.resolve(vaultBasePath, pluginDirectory, `companion-${id}.cjs`);
  try {
    const info = await fs.promises.stat(file);
    if (!info.isFile()) throw new Error("Not a file");
  } catch {
    throw new Error(
      `The ${id} adapter is missing. Place companion-${id}.cjs next to main.js. The standard plugin package of main.js, manifest.json, and styles.css does not include it.`
    );
  }
  return file;
}

export async function signInCompanion(
  definition: CompanionDefinition,
  handlers: BackendSignInHandlers = {},
  interactive = false
): Promise<void> {
  const binaryPath = await configureCompanion(
    definition,
    getSettings().agentMode.backends[definition.id]?.binaryPath
  );
  const env = companionEnvironment(
    definition.id,
    getSettings().agentMode.backends[definition.id] ?? {}
  );
  const invocation = companionInvocation(
    binaryPath,
    definition.loginArgs,
    process.platform,
    env.COMSPEC
  );
  if (definition.loginArgs.length && !interactive) {
    const result = await signInWithCli(
      invocation.command,
      invocation.args,
      env,
      async () => ({ loggedIn: false }),
      handlers
    ).done;
    if (!result.loggedIn)
      handlers.onLine?.(
        "Login process ended. Authentication has not been verified; start a chat to check it or use Sign in in terminal if input is required."
      );
    return;
  }
  const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
  if (process.platform === "win32") {
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    const os = requireNodeModule<typeof import("node:os")>("os");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const script = path.join(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "copilot-login-")),
      "login.ps1"
    );
    await fs.promises.writeFile(
      script,
      `try { & '${binaryPath.replace(/'/g, "''")}' ${definition.loginArgs.map((arg) => "'" + arg.replace(/'/g, "''") + "'").join(" ")} } finally { Remove-Item -LiteralPath $PSCommandPath }
Read-Host 'Close this window after signing in'`,
      "utf8"
    );
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env,
    })
      .on("error", (error) => handlers.onLine?.(error.message))
      .unref();
  } else if (process.platform === "darwin") {
    const invocationText = [binaryPath, ...definition.loginArgs]
      .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
      .join(" ");
    const appleScript = `tell application "Terminal" to do script ${JSON.stringify(invocationText)}`;
    await runCompanionCommand("osascript", ["-e", appleScript], env);
  } else {
    spawn("x-terminal-emulator", ["-e", binaryPath, ...definition.loginArgs], {
      detached: true,
      stdio: "ignore",
      env,
    })
      .on("error", (error) => handlers.onLine?.(String(error)))
      .unref();
  }
  handlers.onLine?.("Finish signing in in the terminal, then start a chat to verify your account.");
}
