import { resetSettings, updateSetting } from "@/settings/model";
import { buildOpencodeConfig, OpencodeBackend } from "./OpencodeBackend";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("buildOpencodeConfig", () => {
  beforeEach(() => {
    resetSettings();
  });

  it("emits provider entries only for non-empty keys", async () => {
    updateSetting("anthropicApiKey", "anth-123");
    updateSetting("openAIApiKey", "");
    updateSetting("googleApiKey", "g-456");
    const cfg = (await buildOpencodeConfig()) as { provider: Record<string, unknown> };
    expect(Object.keys(cfg.provider).sort()).toEqual(["anthropic", "google"]);
    expect(cfg.provider.anthropic).toEqual({ options: { apiKey: "anth-123" } });
    expect(cfg.provider.google).toEqual({ options: { apiKey: "g-456" } });
  });

  it("returns empty provider map when no keys are set", async () => {
    const cfg = (await buildOpencodeConfig()) as { provider: Record<string, unknown> };
    expect(cfg.provider).toEqual({});
  });
});

describe("OpencodeBackend.buildSpawnDescriptor", () => {
  beforeEach(() => {
    resetSettings();
  });

  it("throws if no binary is installed", async () => {
    const backend = new OpencodeBackend();
    await expect(backend.buildSpawnDescriptor({ vaultBasePath: "/vault" })).rejects.toThrow(
      /binary not installed/
    );
  });

  it("uses settings.agentMode.binaryPath as command and passes cwd in args", async () => {
    updateSetting("agentMode", {
      enabled: true,
      byok: {},
      mcpServers: [],
      binaryPath: "/path/to/opencode",
      binaryVersion: "1.3.17",
      binarySource: "managed",
    });
    updateSetting("anthropicApiKey", "anth-xyz");
    const backend = new OpencodeBackend();
    const desc = await backend.buildSpawnDescriptor({ vaultBasePath: "/vault/abs" });
    expect(desc.command).toBe("/path/to/opencode");
    expect(desc.args).toEqual(["acp", "--cwd", "/vault/abs"]);
    expect(desc.env.OPENCODE_CONFIG_CONTENT).toBeDefined();
    const cfg = JSON.parse(desc.env.OPENCODE_CONFIG_CONTENT as string);
    expect(cfg.provider.anthropic).toEqual({ options: { apiKey: "anth-xyz" } });
  });
});
