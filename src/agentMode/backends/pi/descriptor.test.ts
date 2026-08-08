import type { CopilotSettings } from "@/settings/model";
import { PiBackendDescriptor } from "./descriptor";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function settingsWithPi(enabled: boolean | undefined): CopilotSettings {
  return { agentMode: { backends: { pi: { enabled } } } } as unknown as CopilotSettings;
}

describe("PiBackendDescriptor", () => {
  describe("model routing", () => {
    it("routes Copilot-hosted models and explains the bundled provider choices", () => {
      expect(PiBackendDescriptor.routesCopilotModels).toBe(true);
      expect(PiBackendDescriptor.setupDescription).toContain("Built into Copilot");
    });
  });

  describe("getInstallState()", () => {
    it("reports ready only while the opt-in toggle is on", () => {
      expect(PiBackendDescriptor.getInstallState(settingsWithPi(true))).toEqual({
        kind: "ready",
        source: "managed",
      });
    });

    it("reports absent when the toggle is off, so every agent surface hides Pi", () => {
      expect(PiBackendDescriptor.getInstallState(settingsWithPi(false)).kind).toBe("absent");
    });

    it("reports absent when the slice was never written", () => {
      expect(PiBackendDescriptor.getInstallState({} as CopilotSettings).kind).toBe("absent");
      expect(PiBackendDescriptor.getInstallState(settingsWithPi(undefined)).kind).toBe("absent");
    });
  });

  describe("wire", () => {
    it("round-trips a model id unchanged, since pi has no effort dimension", () => {
      const decoded = PiBackendDescriptor.wire.decode("kimi-k2.6");

      expect(decoded).toEqual({
        selection: { baseModelId: "kimi-k2.6", effort: null },
        provider: null,
      });
      expect(PiBackendDescriptor.wire.encode(decoded.selection)).toBe("kimi-k2.6");
    });

    it("drops an effort rather than encoding one pi cannot honor", () => {
      expect(PiBackendDescriptor.wire.encode({ baseModelId: "glm-5.2", effort: "high" })).toBe(
        "glm-5.2"
      );
    });
  });

  describe("restart policy", () => {
    it("restarts on provider config changes but not on system-prompt changes", () => {
      // Provider rows and keys are baked into the collection at backend start,
      // while the system prompt is captured per session.
      expect(PiBackendDescriptor.restartOnProviderConfigChange).toBe(true);
      expect(PiBackendDescriptor.restartOnSystemPromptChange).toBe(false);
      expect(PiBackendDescriptor.restartOnManagedSkillsChange).toBe(false);
    });
  });
});
