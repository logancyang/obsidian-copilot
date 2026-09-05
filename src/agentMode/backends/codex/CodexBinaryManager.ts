import {
  createManagedInstallRuntime,
  promoteManagedVersion,
  type ManagedInstallRuntimeState,
} from "@/agentMode/backends/shared/managedInstall";
import type { ManagedInstallActionState } from "@/agentMode/session/types";
import { copilotAppDataDir } from "@/utils/appPaths";
import { augmentPathForDetection } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import { updateAgentModeBackendFields } from "@/settings/model";
import { buildCodexAcpInvocation, resolveSupportedCodexAcpPackage } from "./codexVersion";
import { CODEX_ACP_PINNED_VERSION } from "./cliSetup";

const PACKAGE = "@agentclientprotocol/codex-acp";
const TIMEOUT_MS = 5 * 60_000;

type CodexInstallProgress = { label: string; percent: number };

export class CodexBinaryManager {
  private readonly runtime = createManagedInstallRuntime<CodexInstallProgress>("Codex adapter");
  readonly subscribeRuntimeState = (onChange: () => void): (() => void) =>
    this.runtime.subscribe(onChange);
  readonly getRuntimeState = (): ManagedInstallRuntimeState<CodexInstallProgress> =>
    this.runtime.getSnapshot();
  readonly getActionState = (): ManagedInstallActionState => {
    const state = this.runtime.getSnapshot();
    if (state.kind === "installing") {
      return {
        kind: "running",
        label: state.progress?.label ?? "Starting…",
        percent: state.progress?.percent ?? 0,
      };
    }
    if (state.kind === "error") return state;
    return { kind: "idle" };
  };
  getDataDir(): string {
    const home = requireNodeModule<typeof import("node:os")>("os").homedir();
    if (!home || !path().isAbsolute(home) || path().parse(home).root === home) {
      throw new Error("Could not resolve your home directory for the managed Codex adapter.");
    }
    return path().join(copilotAppDataDir(home), "codex");
  }
  async install(): Promise<void> {
    return this.runtime.run({ kind: "installing", progress: null }, async (signal) => {
      const dataDir = this.getDataDir();
      const versionDir = path().join(dataDir, CODEX_ACP_PINNED_VERSION);
      const stageDir = path().join(dataDir, `.tmp-${CODEX_ACP_PINNED_VERSION}-${Date.now()}`);
      await fs().promises.mkdir(stageDir, { recursive: true });
      try {
        this.runtime.publishProgress({ label: "Installing the Codex adapter…", percent: 30 });
        await installPackage(stageDir, signal);
        this.runtime.publishProgress({ label: "Verifying the Codex adapter…", percent: 85 });
        const stagedEntry = entryPath(stageDir);
        // Exact-version guard: https://github.com/Brevilabs/obsidian-copilot-private/issues/368
        const staged = resolveSupportedCodexAcpPackage(stagedEntry);
        if (staged.version !== CODEX_ACP_PINNED_VERSION) {
          throw new Error(
            `npm installed ${PACKAGE} ${staged.version}; expected ${CODEX_ACP_PINNED_VERSION}.`
          );
        }
        await verifyLauncher(stagedEntry, signal);
        await fs().promises.writeFile(
          path().join(stageDir, "install-manifest.json"),
          JSON.stringify({ version: CODEX_ACP_PINNED_VERSION })
        );
        await promoteManagedVersion(stageDir, versionDir, "Codex adapter");
        const finalEntry = entryPath(versionDir);
        updateAgentModeBackendFields("codex", {
          binaryPath: finalEntry,
          binaryVersion: CODEX_ACP_PINNED_VERSION,
          binarySource: "managed",
        });
        this.runtime.publishProgress({ label: "Codex adapter ready.", percent: 100 });
      } finally {
        await fs()
          .promises.rm(stageDir, { recursive: true, force: true })
          .catch(() => {});
      }
    });
  }
}

function entryPath(versionDir: string): string {
  return path().join(versionDir, "node_modules/@agentclientprotocol/codex-acp/dist/index.js");
}

async function installPackage(prefix: string, signal: AbortSignal): Promise<void> {
  const windows = process.platform === "win32";
  const npm = windows
    ? await run("where", ["npm"], signal).then(
        ({ stdout }) => stdout.match(/^.*npm\.(?:cmd|exe)$/im)?.[0].trim(),
        () => null
      )
    : await detectBinary("npm");
  if (!npm) throw new Error("npm was not found. Install Node.js, restart Obsidian, then retry.");
  const npmPaths = windows ? path().win32 : path();
  const npmDir = npmPaths.dirname(npm);
  const npmShim = windows && /\.cmd$/i.test(npm);
  const command = npmShim ? npmPaths.join(npmDir, "node.exe") : npm;
  const commandArgs = npmShim
    ? [npmPaths.join(npmDir, "node_modules", "npm", "bin", "npm-cli.js")]
    : [];
  await run(
    command,
    [
      ...commandArgs,
      "install",
      "--prefix",
      prefix,
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save=false",
      "--package-lock=false",
      `${PACKAGE}@${CODEX_ACP_PINNED_VERSION}`,
    ],
    signal
  );
}

async function verifyLauncher(entry: string, signal: AbortSignal): Promise<void> {
  const env = { ...process.env, PATH: augmentPathForDetection(process.env.PATH) };
  const node = process.platform === "win32" ? await detectBinary("node") : undefined;
  const invocation = buildCodexAcpInvocation(
    entry,
    ["--version"],
    env,
    process.platform,
    node ?? undefined
  );
  const { stdout } = await run(invocation.command, invocation.args, signal, invocation.env);
  if (!stdout.includes(CODEX_ACP_PINNED_VERSION)) {
    throw new Error(`The Codex adapter did not report version ${CODEX_ACP_PINNED_VERSION}.`);
  }
}

function run(
  command: string,
  args: string[],
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = { ...process.env, PATH: augmentPathForDetection(process.env.PATH) }
): Promise<{ stdout: string; stderr: string }> {
  const childProcess = requireNodeModule<typeof import("node:child_process")>("child_process");
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      command,
      args,
      {
        env,
        signal,
        timeout: TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr }))
    );
  });
}

function fs(): typeof import("node:fs") {
  return requireNodeModule<typeof import("node:fs")>("fs");
}

function path(): typeof import("node:path") {
  return requireNodeModule<typeof import("node:path")>("path");
}
