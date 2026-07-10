import {
  CODEX_ACP_MIGRATION_COMMAND,
  CODEX_ACP_MIN_VERSION,
  CODEX_CLI_MIN_VERSION,
} from "@/constants";
import type { CodexProbeMetadata } from "@/settings/model";
import {
  CodexBinaryManager,
  codexProbeSettingsFingerprint,
  codexInstallState,
  launcherForConfiguredPath,
  parseCodexVersion,
  type CodexProbeRunner,
} from "./CodexBinaryManager";

const PATH = "/usr/local/bin/codex-acp";

function managerWith(outputs: Array<string | Error>) {
  const persisted: CodexProbeMetadata[] = [];
  const run = jest
    .fn<ReturnType<CodexProbeRunner>, Parameters<CodexProbeRunner>>()
    .mockImplementation(async () => {
      const value = outputs.shift();
      if (value instanceof Error) throw value;
      return { stdout: value ?? "", stderr: "" };
    });
  const manager = new CodexBinaryManager({
    run,
    fileExists: (candidate) => candidate === PATH,
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    persist: (probe) => persisted.push(probe),
    baseEnv: { PATH: "/usr/bin" },
  });
  return { manager, run, persisted };
}

describe("CodexBinaryManager", () => {
  it("blocks a legacy Zed adapter with the migration command", async () => {
    const { manager } = managerWith(["@zed-industries/codex-acp 0.8.1"]);
    const probe = await manager.refreshInstallState({ binaryPath: PATH });

    expect(probe.kind).toBe("legacy");
    expect(codexInstallState({ binaryPath: PATH, probe })).toMatchObject({
      kind: "blocked",
      remediation: CODEX_ACP_MIGRATION_COMMAND,
    });
  });

  it("reports supported adapter and bundled effective CLI versions", async () => {
    const { manager, run } = managerWith([
      `codex-acp ${CODEX_ACP_MIN_VERSION}`,
      `codex-cli ${CODEX_CLI_MIN_VERSION}`,
    ]);
    const probe = await manager.refreshInstallState({ binaryPath: PATH });

    expect(probe).toMatchObject({
      kind: "supported",
      adapterVersion: CODEX_ACP_MIN_VERSION,
      cliVersion: CODEX_CLI_MIN_VERSION,
      cliSource: "bundled",
    });
    expect(run.mock.calls.map((call) => call[1])).toEqual([["--version"], ["cli", "--version"]]);
  });

  it("reports CODEX_PATH provenance and passes overrides to both probes", async () => {
    const { manager, run } = managerWith(["codex-acp 1.2.0", "codex 0.150.0"]);
    const probe = await manager.refreshInstallState({
      binaryPath: PATH,
      envOverrides: { CODEX_PATH: "/opt/codex/custom" },
    });

    expect(probe).toMatchObject({
      kind: "supported",
      cliVersion: "0.150.0",
      cliSource: "override",
      cliPath: "/opt/codex/custom",
    });
    expect(run.mock.calls[1][2].CODEX_PATH).toBe("/opt/codex/custom");
  });

  it("does not reuse health recorded for a different launcher path", () => {
    const original = { binaryPath: PATH };
    expect(
      codexInstallState({
        binaryPath: "/new/codex-acp",
        probe: {
          kind: "supported",
          launcherPath: PATH,
          settingsFingerprint: codexProbeSettingsFingerprint(original),
          probedAt: "2026-07-10T12:00:00.000Z",
        },
      })
    ).toEqual({ kind: "absent" });
  });

  it.each([
    ["adapter", "1.1.1", "0.150.0"],
    ["adapter prerelease", `${CODEX_ACP_MIN_VERSION}-beta.1`, "0.150.0"],
    ["CLI", "1.2.0", "0.143.9"],
    ["CLI prerelease", "1.2.0", `${CODEX_CLI_MIN_VERSION}-beta.1`],
  ])("classifies a below-minimum %s", async (_label, adapter, cli) => {
    const { manager } = managerWith([`codex-acp ${adapter}`, `codex ${cli}`]);
    await expect(manager.refreshInstallState({ binaryPath: PATH })).resolves.toMatchObject({
      kind: "below-minimum",
      adapterVersion: adapter,
      cliVersion: cli,
    });
  });

  it("classifies invalid version output", async () => {
    const { manager } = managerWith(["unexpected output"]);
    await expect(manager.refreshInstallState({ binaryPath: PATH })).resolves.toMatchObject({
      kind: "invalid",
      reason: expect.stringContaining("unrecognized adapter version"),
    });
  });

  it.each([
    [Object.assign(new Error("timed out"), { killed: true }), "timed out"],
    [
      Object.assign(new Error("too much output"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
      "output limit",
    ],
  ])("turns bounded probe failures into invalid health", async (error, reason) => {
    const { manager } = managerWith([error]);
    await expect(manager.refreshInstallState({ binaryPath: PATH })).resolves.toMatchObject({
      kind: "invalid",
      reason: expect.stringContaining(reason),
    });
  });

  it("coalesces concurrent refreshes into one cached probe", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = jest
      .fn<ReturnType<CodexProbeRunner>, Parameters<CodexProbeRunner>>()
      .mockImplementation(async (_launcher, args) => {
        await gate;
        return {
          stdout: args[0] === "--version" ? "codex-acp 1.2.0" : "codex 0.150.0",
          stderr: "",
        };
      });
    const manager = new CodexBinaryManager({ run, fileExists: () => true, persist: () => {} });

    const first = manager.refreshInstallState({ binaryPath: PATH });
    const second = manager.refreshInstallState({ binaryPath: PATH });
    expect(first).toBe(second);
    release();
    await first;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce different settings or persist a stale completion", async () => {
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => (releaseStale = resolve));
    const persisted: CodexProbeMetadata[] = [];
    const run = jest
      .fn<ReturnType<CodexProbeRunner>, Parameters<CodexProbeRunner>>()
      .mockImplementation(async (_launcher, args, env) => {
        if (env.CODEX_PATH !== "/new/codex") await staleGate;
        return {
          stdout:
            args[0] === "--version"
              ? "codex-acp 1.2.0"
              : `codex ${env.CODEX_PATH === "/new/codex" ? "0.151.0" : "0.150.0"}`,
          stderr: "",
        };
      });
    const manager = new CodexBinaryManager({
      run,
      fileExists: () => true,
      persist: (probe) => persisted.push(probe),
    });

    const stale = manager.refreshInstallState({ binaryPath: PATH });
    const current = manager.refreshInstallState({
      binaryPath: PATH,
      envOverrides: { CODEX_PATH: "/new/codex" },
    });
    expect(stale).not.toBe(current);

    await current;
    releaseStale();
    await stale;

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ cliPath: "/new/codex", cliVersion: "0.151.0" });
  });

  it("invalidates cached health after an environment override changes", async () => {
    const settings = { binaryPath: PATH, envOverrides: { CODEX_PATH: "/old/codex" } };
    const { manager } = managerWith(["codex-acp 1.2.0", "codex 0.150.0"]);
    const probe = await manager.refreshInstallState(settings);

    expect(codexInstallState({ ...settings, probe }).kind).toBe("ready");
    expect(
      codexInstallState({
        binaryPath: PATH,
        envOverrides: { CODEX_PATH: "/new/codex" },
        probe,
      })
    ).toEqual({ kind: "absent" });
  });

  it("classifies a filesystem probe exception as absent", async () => {
    const manager = new CodexBinaryManager({
      fileExists: () => {
        throw new Error("transient mount failure");
      },
      persist: () => {},
    });

    await expect(manager.refreshInstallState({ binaryPath: PATH })).resolves.toMatchObject({
      kind: "absent",
    });
  });
});

describe("Codex version and launcher helpers", () => {
  it("parses labeled and v-prefixed semver output", () => {
    expect(parseCodexVersion("codex-acp v1.2.3\n")).toBe("1.2.3");
    expect(parseCodexVersion("codex-acp 1.2.3-beta.1+build.4")).toBe("1.2.3-beta.1+build.4");
    expect(parseCodexVersion("not-a-version")).toBeUndefined();
  });

  it("builds a shell-free Windows Node descriptor", () => {
    expect(
      launcherForConfiguredPath("C:\\npm\\dist\\index.js", "win32", "C:\\node\\node.exe")
    ).toEqual({
      command: "C:\\node\\node.exe",
      args: ["C:\\npm\\dist\\index.js"],
      adapterPath: "C:\\npm\\dist\\index.js",
      kind: "node",
    });
  });

  it("does not fall back to the host executable for a Windows JavaScript entry", async () => {
    const manager = new CodexBinaryManager({
      platform: "win32",
      fileExists: () => true,
      run: jest.fn(),
      persist: () => {},
    });

    await expect(
      manager.refreshInstallState({ binaryPath: "C:\\npm\\dist\\index.js" })
    ).resolves.toMatchObject({
      kind: "invalid",
      reason: expect.stringContaining("Node executable is required"),
    });
  });
});
