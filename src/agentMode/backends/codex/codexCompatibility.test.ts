import {
  buildCodexEnvironment,
  CODEX_ACP_UPDATE_MESSAGE,
  CODEX_REMOVE_LEGACY_COMMAND,
  getCodexCompatibility,
  getCodexInstallGuidance,
  probeCodexAcpCompatibility,
  refreshCodexCompatibility,
  subscribeCodexCompatibility,
  type CodexVersionRunner,
} from "./codexCompatibility";

describe("codexCompatibility", () => {
  describe("getCodexInstallGuidance()", () => {
    it("uses one native PowerShell bootstrap command on Windows", () => {
      expect(getCodexInstallGuidance("win32")).toEqual({
        installCommand:
          "irm https://raw.githubusercontent.com/logancyang/obsidian-copilot/78723aec5ebe3a1fa271ebf437511550a97f3266/docs/install-codex-agent-mode-windows.ps1 | iex",
        removeLegacyCommand: null,
        updateMessage:
          "Copilot could not verify this as the maintained Codex ACP adapter. The superseded adapter cannot provide current Codex models. Run the Windows PowerShell install command, then select the new codex-acp.cmd path.",
      });
    });

    it("uses separate npm migration commands outside Windows", () => {
      const guidance = getCodexInstallGuidance("darwin");

      expect(guidance.installCommand).toBe("npm install -g @agentclientprotocol/codex-acp");
      expect(guidance.removeLegacyCommand).toBe(CODEX_REMOVE_LEGACY_COMMAND);
      expect(guidance.updateMessage).toContain(CODEX_REMOVE_LEGACY_COMMAND);
      expect(guidance.updateMessage).toContain(guidance.installCommand);
    });
  });

  describe("buildCodexEnvironment()", () => {
    it("normalizes Windows PATH casing so the configured override reaches Node", () => {
      expect(
        buildCodexEnvironment(
          "C:\\portable\\codex-acp.cmd",
          { PATH: "C:\\generated-node", TOKEN: "base" },
          { Path: "D:\\portable-node\\bin", TOKEN: "configured" },
          "win32"
        )
      ).toEqual({
        PATH: "D:\\portable-node\\bin",
        TOKEN: "configured",
      });
    });
  });

  describe("probeCodexAcpCompatibility()", () => {
    it("accepts the maintained adapter identity reported by the selected executable", async () => {
      const run = jest
        .fn<ReturnType<CodexVersionRunner>, Parameters<CodexVersionRunner>>()
        .mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.2\n" });

      await expect(probeCodexAcpCompatibility("/usr/local/bin/codex-acp", run)).resolves.toEqual({
        kind: "ready",
        source: "custom",
      });
      expect(run).toHaveBeenCalledWith(
        "/usr/local/bin/codex-acp",
        ["--version"],
        expect.objectContaining({
          env: expect.objectContaining({ PATH: expect.any(String) }),
          timeout: 10_000,
        })
      );
    });

    it("probes a Windows npm shim through its maintained adapter entry point", async () => {
      const run = jest
        .fn<ReturnType<CodexVersionRunner>, Parameters<CodexVersionRunner>>()
        .mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.7\n" });

      await expect(
        probeCodexAcpCompatibility(
          "C:\\Users\\me\\AppData\\Roaming\\npm\\codex-acp.cmd",
          run,
          "win32",
          undefined,
          () =>
            '"%_prog%" "%dp0%\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js" %*'
        )
      ).resolves.toEqual({ kind: "ready", source: "custom" });
      expect(run).toHaveBeenCalledWith(
        "node",
        [
          "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js",
          "--version",
        ],
        expect.objectContaining({ timeout: 10_000 })
      );
    });

    it.each([
      [
        "the superseded adapter rejects the identity flag",
        () => Promise.reject(new Error("exit 2")),
      ],
      [
        "an executable reports an unrelated identity",
        () => Promise.resolve({ stdout: "codex-acp 9.9.9" }),
      ],
    ])("rejects the path when %s", async (_scenario, result) => {
      const run = jest
        .fn<ReturnType<CodexVersionRunner>, Parameters<CodexVersionRunner>>()
        .mockImplementation(result);

      await expect(probeCodexAcpCompatibility("/usr/local/bin/codex-acp", run)).resolves.toEqual({
        kind: "error",
        message: CODEX_ACP_UPDATE_MESSAGE,
      });
    });

    it("returns the native Windows recovery path for an incompatible npm shim", async () => {
      const run = jest
        .fn<ReturnType<CodexVersionRunner>, Parameters<CodexVersionRunner>>()
        .mockResolvedValue({ stdout: "codex-acp 0.8.1\n" });

      await expect(
        probeCodexAcpCompatibility(
          "C:\\Users\\me\\AppData\\Roaming\\npm\\codex-acp.cmd",
          run,
          "win32",
          undefined,
          () =>
            '"%_prog%" "%dp0%\\node_modules\\@agentclientprotocol\\codex-acp\\dist\\index.js" %*'
        )
      ).resolves.toEqual({
        kind: "error",
        message: getCodexInstallGuidance("win32").updateMessage,
      });
    });
  });

  describe("getCodexCompatibility()", () => {
    it("returns a stable checking snapshot until the selected path is verified", () => {
      const first = getCodexCompatibility("/checking/codex-acp");

      expect(first).toEqual({ kind: "checking", source: "custom" });
      expect(getCodexCompatibility("/checking/codex-acp")).toBe(first);
    });
  });

  describe("refreshCodexCompatibility()", () => {
    it("publishes the probe result and notifies subscribers", async () => {
      const listener = jest.fn();
      const run = jest
        .fn<ReturnType<CodexVersionRunner>, Parameters<CodexVersionRunner>>()
        .mockRejectedValue(new Error("exit 2"));
      const unsubscribe = subscribeCodexCompatibility(
        () => ({ binaryPath: "/publish/codex-acp" }),
        listener
      );

      await expect(refreshCodexCompatibility("/publish/codex-acp", { run })).resolves.toEqual({
        kind: "error",
        message: CODEX_ACP_UPDATE_MESSAGE,
      });
      unsubscribe();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(getCodexCompatibility("/publish/codex-acp")).toEqual({
        kind: "error",
        message: CODEX_ACP_UPDATE_MESSAGE,
      });
    });

    it("deduplicates concurrent probes for the same path", async () => {
      let resolveRun!: (value: { stdout: string }) => void;
      const run = jest.fn(
        () => new Promise<{ stdout: string }>((resolve) => (resolveRun = resolve))
      );

      const first = refreshCodexCompatibility("/concurrent/codex-acp", { run });
      const second = refreshCodexCompatibility("/concurrent/codex-acp", { run });

      expect(first).toBe(second);
      expect(run).toHaveBeenCalledTimes(1);

      resolveRun({ stdout: "@agentclientprotocol/codex-acp 1.1.2" });
      await expect(first).resolves.toEqual({ kind: "ready", source: "custom" });
    });

    it("keeps compatibility results independent across selected paths", async () => {
      const legacyRun = jest.fn().mockRejectedValue(new Error("exit 2"));
      const maintainedRun = jest
        .fn()
        .mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.2" });

      await refreshCodexCompatibility("/legacy/codex-acp", { run: legacyRun });
      await refreshCodexCompatibility("/maintained/codex-acp", { run: maintainedRun });

      expect(getCodexCompatibility("/legacy/codex-acp")).toEqual({
        kind: "error",
        message: CODEX_ACP_UPDATE_MESSAGE,
      });
      expect(getCodexCompatibility("/maintained/codex-acp")).toEqual({
        kind: "ready",
        source: "custom",
      });
    });

    it("uses environment overrides in both the probe and cache identity", async () => {
      const run = jest
        .fn<ReturnType<CodexVersionRunner>, Parameters<CodexVersionRunner>>()
        .mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.7" });
      const envOverrides = { TOKEN: "configured", PATH: "/portable/node/bin" };

      await refreshCodexCompatibility("/env/codex-acp", { envOverrides, run });

      expect(run).toHaveBeenCalledWith(
        "/env/codex-acp",
        ["--version"],
        expect.objectContaining({
          env: expect.objectContaining(envOverrides),
        })
      );
      expect(
        getCodexCompatibility("/env/codex-acp", {
          PATH: "/portable/node/bin",
          TOKEN: "configured",
        })
      ).toEqual({ kind: "ready", source: "custom" });
      expect(getCodexCompatibility("/env/codex-acp")).toEqual({
        kind: "checking",
        source: "custom",
      });
    });
  });

  describe("subscribeCodexCompatibility()", () => {
    it("ignores publications from a path that is no longer selected", async () => {
      let selectedPath = "/selected-a/codex-acp";
      const listener = jest.fn();
      const unsubscribe = subscribeCodexCompatibility(
        () => ({ binaryPath: selectedPath }),
        listener
      );

      selectedPath = "/selected-b/codex-acp";
      await refreshCodexCompatibility("/selected-a/codex-acp", {
        run: jest.fn().mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.7" }),
      });
      expect(listener).not.toHaveBeenCalled();

      await refreshCodexCompatibility("/selected-b/codex-acp", {
        run: jest.fn().mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.7" }),
      });
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();
    });

    it("stops notifying a listener after unsubscribe", async () => {
      const listener = jest.fn();
      const unsubscribe = subscribeCodexCompatibility(
        () => ({ binaryPath: "/unsubscribed/codex-acp" }),
        listener
      );
      unsubscribe();

      await refreshCodexCompatibility("/unsubscribed/codex-acp", {
        run: jest.fn().mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.2" }),
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
