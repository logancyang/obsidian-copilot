import { act, renderHook } from "@testing-library/react";
import { useChatModelPicker } from "./useChatModelPicker";
const mockEntries = [
  {
    state: "ok",
    configuredModelId: "model-a",
    provider: {
      providerId: "p",
      providerType: "openai-compatible",
      displayName: "OpenAI",
      origin: { kind: "byok", catalogProviderId: "openai" },
      requiresApiKey: false,
    },
    configuredModel: {
      configuredModelId: "model-a",
      providerId: "p",
      info: { id: "gpt-4o", displayName: "GPT-4o" },
    },
  },
];
jest.mock("jotai", () => ({ useAtomValue: () => mockEntries }));
jest.mock("@/modelManagement", () => ({
  ...jest.requireActual<typeof import("@/modelManagement/chatModel/chatModelSelection")>(
    "@/modelManagement/chatModel/chatModelSelection"
  ),
  chatBackendPickerAtom: "chat",
  capabilitiesFromConfiguredInfo: () => ({}),
  mapProviderTypeToChatModelProvider: () => "openai",
  providerRequiresApiKey: () => false,
}));
jest.mock("@/settings/model", () => ({
  settingsStore: {},
  useSettingsValue: () => ({ providers: {}, copilotPlusCatalog: [] }),
  getModelKeyFromModel: (model: { name: string; provider: string }) =>
    `${model.name}|${model.provider}`,
}));
jest.mock("@/lib/lockedCopilotEntries", () => ({ shouldPreviewCopilotModels: () => false }));
describe("useChatModelPicker", () => {
  describe("useChatModelPicker()", () => {
    it("shows the explicitly selected legacy model and returns configured IDs on selection", () => {
      const onChange = jest.fn();
      const { result } = renderHook(() =>
        useChatModelPicker({ value: "gpt-4o|openai", onChange, fallbackToFirst: false })
      );
      expect(result.current.value).toBe("model-a|openai");
      act(() => result.current.onChange("model-a|openai"));
      expect(onChange).toHaveBeenCalledWith("model-a");
    });
    it.each([undefined, "", "removed"])(
      "keeps strict selection %s empty until the user picks (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)",
      (value) => {
        const { result } = renderHook(() =>
          useChatModelPicker({ value, onChange: jest.fn(), fallbackToFirst: false })
        );
        expect(result.current.value).toBe("");
        expect(result.current.models[0].displayName).toBe("GPT-4o");
      }
    );
    it("retains first-model fallback for chat callers", () => {
      const { result } = renderHook(() =>
        useChatModelPicker({ value: "removed", onChange: jest.fn() })
      );
      expect(result.current.value).toBe("model-a|openai");
    });
  });
});
