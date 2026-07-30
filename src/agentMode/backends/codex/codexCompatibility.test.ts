import {
  CODEX_ACP_UPDATE_MESSAGE,
  getCodexCompatibility,
  probeCodexAcpCompatibility,
  refreshCodexCompatibility,
  subscribeCodexCompatibility,
  type CodexVersionRunner,
} from "./codexCompatibility";

describe("codexCompatibility", () => {
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
          "win32"
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
      const unsubscribe = subscribeCodexCompatibility(listener);

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
  });

  describe("subscribeCodexCompatibility()", () => {
    it("stops notifying a listener after unsubscribe", async () => {
      const listener = jest.fn();
      const unsubscribe = subscribeCodexCompatibility(listener);
      unsubscribe();

      await refreshCodexCompatibility("/unsubscribed/codex-acp", {
        run: jest.fn().mockResolvedValue({ stdout: "@agentclientprotocol/codex-acp 1.1.2" }),
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
