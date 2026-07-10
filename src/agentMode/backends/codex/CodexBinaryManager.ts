import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

import {
  CODEX_ACP_MIGRATION_COMMAND,
  CODEX_ACP_MIN_VERSION,
  CODEX_CLI_MIN_VERSION,
} from "@/constants";
import type { InstallState } from "@/agentMode/session/types";
import {
  getSettings,
  updateAgentModeBackendFields,
  type CodexBackendSettings,
  type CodexProbeMetadata,
} from "@/settings/model";
import type { CodexLauncherDescriptor } from "./codexBinaryResolver";

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_OUTPUT_BYTES = 64 * 1024;

interface ProbeExecutionResult {
  stdout: string;
  stderr: string;
}

export type CodexProbeRunner = (
  launcher: CodexLauncherDescriptor,
  args: string[],
  env: NodeJS.ProcessEnv
) => Promise<ProbeExecutionResult>;

export interface CodexBinaryManagerDependencies {
  run?: CodexProbeRunner;
  fileExists?: (path: string) => boolean;
  now?: () => Date;
  persist?: (probe: CodexProbeMetadata) => void;
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Resolved node executable used for Windows npm JavaScript entries. */
  nodePath?: string;
}

export function launcherForConfiguredPath(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
  nodePath?: string
): CodexLauncherDescriptor {
  if (platform === "win32" && binaryPath.toLowerCase().endsWith(".js")) {
    if (!nodePath) throw new Error("A Node executable is required for the Windows Codex adapter.");
    return { command: nodePath, args: [binaryPath], adapterPath: binaryPath, kind: "node" };
  }
  return { command: binaryPath, args: [], adapterPath: binaryPath, kind: "executable" };
}

export function parseCodexVersion(output: string): string | undefined {
  return output.match(
    /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=\s|$)/
  )?.[1];
}

export function codexProbeSettingsFingerprint(settings: CodexBackendSettings | undefined): string {
  const envOverrides = Object.entries(settings?.envOverrides ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return createHash("sha256")
    .update(JSON.stringify([settings?.binaryPath ?? null, envOverrides]))
    .digest("hex");
}

export function codexInstallState(settings: CodexBackendSettings | undefined): InstallState {
  const probe = settings?.probe;
  if (
    !settings?.binaryPath ||
    !probe ||
    probe.kind === "absent" ||
    probe.launcherPath !== settings.binaryPath ||
    probe.settingsFingerprint !== codexProbeSettingsFingerprint(settings)
  ) {
    return { kind: "absent" };
  }
  const details = {
    adapterVersion: probe.adapterVersion,
    cliVersion: probe.cliVersion,
    cliSource: probe.cliSource,
    warning:
      probe.cliSource === "override"
        ? `CODEX_PATH uses ${probe.cliPath ?? "a custom Codex CLI"} outside the adapter's bundled compatibility set.`
        : undefined,
  };
  if (probe.kind === "supported") return { kind: "ready", source: "custom", details };
  if (probe.kind === "legacy" || probe.kind === "below-minimum") {
    return {
      kind: "blocked",
      reason: probe.reason ?? "This Codex adapter must be updated before Agent Mode can start.",
      remediation: CODEX_ACP_MIGRATION_COMMAND,
      details,
    };
  }
  return {
    kind: "error",
    message: probe.reason ?? "Codex installation health could not be verified.",
  };
}

export class CodexBinaryManager {
  private readonly run: CodexProbeRunner;
  private readonly fileExists: (path: string) => boolean;
  private readonly now: () => Date;
  private readonly persist: (probe: CodexProbeMetadata) => void;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly nodePath: string | undefined;
  private inFlight: { key: string; promise: Promise<CodexProbeMetadata> } | null = null;
  private probeGeneration = 0;

  constructor(deps: CodexBinaryManagerDependencies = {}) {
    this.run = deps.run ?? runProbe;
    this.fileExists = deps.fileExists ?? fs.existsSync;
    this.now = deps.now ?? (() => new Date());
    this.persist = deps.persist ?? ((probe) => updateAgentModeBackendFields("codex", { probe }));
    this.baseEnv = deps.baseEnv ?? process.env;
    this.platform = deps.platform ?? process.platform;
    this.nodePath = deps.nodePath;
  }

  getInstallState(
    settings: CodexBackendSettings | undefined = getSettings().agentMode.backends.codex
  ): InstallState {
    return codexInstallState(settings);
  }

  refreshInstallState(
    settings: CodexBackendSettings | undefined = getSettings().agentMode.backends.codex
  ): Promise<CodexProbeMetadata> {
    const key = codexProbeSettingsFingerprint(settings);
    if (this.inFlight?.key === key) return this.inFlight.promise;

    const generation = ++this.probeGeneration;
    const promise = this.probe(settings, generation).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { key, promise };
    return promise;
  }

  private async probe(
    settings: CodexBackendSettings | undefined,
    generation: number
  ): Promise<CodexProbeMetadata> {
    const binaryPath = settings?.binaryPath;
    const probedAt = this.now().toISOString();
    const settingsFingerprint = codexProbeSettingsFingerprint(settings);
    if (!binaryPath || !safeFileExists(this.fileExists, binaryPath)) {
      return this.save(
        { kind: "absent", probedAt, launcherPath: binaryPath, settingsFingerprint },
        generation
      );
    }

    const env = { ...this.baseEnv, ...settings?.envOverrides };
    const common = {
      launcherPath: binaryPath,
      settingsFingerprint,
      probedAt,
    } as const;
    try {
      const launcher = launcherForConfiguredPath(binaryPath, this.platform, this.nodePath);
      const base = { ...common, launcherKind: launcher.kind } as const;
      const adapterResult = await this.run(launcher, ["--version"], env);
      const adapterOutput = `${adapterResult.stdout}\n${adapterResult.stderr}`.trim();
      const adapterVersion = parseCodexVersion(adapterOutput);
      if (!adapterVersion) {
        return this.save(
          {
            ...base,
            kind: "invalid",
            reason: "The configured launcher returned an unrecognized adapter version.",
          },
          generation
        );
      }
      if (/zed-industries|zed codex-acp/i.test(adapterOutput) || adapterVersion.startsWith("0.")) {
        return this.save(
          {
            ...base,
            kind: "legacy",
            adapterVersion,
            reason: "The superseded @zed-industries/codex-acp adapter is installed.",
          },
          generation
        );
      }

      const cliResult = await this.run(launcher, ["cli", "--version"], env);
      const cliVersion = parseCodexVersion(`${cliResult.stdout}\n${cliResult.stderr}`);
      if (!cliVersion) {
        return this.save(
          {
            ...base,
            kind: "invalid",
            adapterVersion,
            reason: "The adapter did not report a recognizable effective Codex CLI version.",
          },
          generation
        );
      }
      const cliPath = env.CODEX_PATH?.trim();
      const cliSource = cliPath ? "override" : "bundled";
      if (
        !isSemverAtLeast(adapterVersion, CODEX_ACP_MIN_VERSION) ||
        !isSemverAtLeast(cliVersion, CODEX_CLI_MIN_VERSION)
      ) {
        return this.save(
          {
            ...base,
            kind: "below-minimum",
            adapterVersion,
            cliVersion,
            cliSource,
            cliPath,
            reason: `Codex requires adapter ${CODEX_ACP_MIN_VERSION}+ and CLI ${CODEX_CLI_MIN_VERSION}+.`,
          },
          generation
        );
      }
      return this.save(
        {
          ...base,
          kind: "supported",
          adapterVersion,
          cliVersion,
          cliSource,
          cliPath,
        },
        generation
      );
    } catch (error) {
      return this.save(
        {
          ...common,
          kind: "invalid",
          reason: probeErrorMessage(error),
        },
        generation
      );
    }
  }

  private save(probe: CodexProbeMetadata, generation: number): CodexProbeMetadata {
    if (generation === this.probeGeneration) this.persist(probe);
    return probe;
  }
}

function safeFileExists(fileExists: (path: string) => boolean, candidate: string): boolean {
  try {
    return fileExists(candidate);
  } catch {
    return false;
  }
}

function isSemverAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string) => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    return match
      ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] }
      : null;
  };
  const current = parse(version);
  const floor = parse(minimum);
  if (!current || !floor) return false;
  for (let i = 0; i < 3; i++) {
    if (current.core[i] !== floor.core[i]) return current.core[i] > floor.core[i];
  }
  if (current.prerelease && !floor.prerelease) return false;
  return true;
}

function runProbe(
  launcher: CodexLauncherDescriptor,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<ProbeExecutionResult> {
  return new Promise((resolve, reject) => {
    execFile(
      launcher.command,
      [...launcher.args, ...args],
      {
        env,
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: PROBE_MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      }
    );
  });
}

function probeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { killed?: boolean; code?: string | number; message?: string };
    if (value.killed || value.code === "ETIMEDOUT") return "The Codex version probe timed out.";
    if (value.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return "The Codex version probe exceeded the output limit.";
    }
    if (value.message) return `The Codex version probe failed: ${value.message}`;
  }
  return "The Codex version probe failed.";
}
