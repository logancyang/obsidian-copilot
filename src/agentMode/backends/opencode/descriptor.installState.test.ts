import type { CopilotSettings } from "@/settings/model";
import { OpencodeBackendDescriptor } from "./descriptor";

jest.mock("@/settings/model", () => ({
  ...jest.requireActual("@/settings/model"),
  subscribeToSettingsChange: jest.fn(),
}));

describe("descriptor", () => {
  describe("OpencodeBackendDescriptor", () => {
    describe("subscribeInstallState()", () => {
      it("ignores model and probe writes while reporting binary changes (https://github.com/logancyang/obsidian-copilot-preview/issues/103)", () => {
        const unsubscribe = jest.fn();
        const { subscribeToSettingsChange } = jest.requireMock<{
          subscribeToSettingsChange: jest.Mock;
        }>("@/settings/model");
        subscribeToSettingsChange.mockReturnValue(unsubscribe);

        const callback = jest.fn();
        expect(OpencodeBackendDescriptor.subscribeInstallState({} as never, callback)).toBe(
          unsubscribe
        );
        const settingsChangeHandler = subscribeToSettingsChange.mock.calls[0][0] as (
          prev: CopilotSettings,
          next: CopilotSettings
        ) => void;
        const settings = (opencode: Record<string, unknown>): CopilotSettings =>
          ({ agentMode: { backends: { opencode } } }) as unknown as CopilotSettings;
        const previousOpencode = {
          binaryPath: "/bin/opencode",
          binaryVersion: "1.0.0",
          binarySource: "managed",
          defaultModel: { baseModelId: "openai/gpt-5", effort: null },
          probeSessionId: "probe-1",
        };
        const previous = settings(previousOpencode);

        for (const change of [
          { defaultModel: { baseModelId: "anthropic/claude-sonnet-4-5", effort: null } },
          { probeSessionId: "probe-2" },
        ]) {
          settingsChangeHandler(previous, settings({ ...previousOpencode, ...change }));
        }
        expect(callback).not.toHaveBeenCalled();

        for (const opencode of [
          { ...previousOpencode, binaryPath: "/new/opencode" },
          { ...previousOpencode, binaryVersion: "2.0.0" },
          { ...previousOpencode, binarySource: "custom" },
        ]) {
          settingsChangeHandler(previous, settings(opencode));
        }
        expect(callback).toHaveBeenCalledTimes(3);
      });
    });
  });
});
