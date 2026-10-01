import { renderHook } from "@testing-library/react";
import { useChatBackendModelOptions } from "./useChatBackendModelOptions";

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
  {
    state: "ok",
    configuredModelId: "model-keyless",
    provider: {
      providerId: "k",
      providerType: "anthropic",
      displayName: "Anthropic",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
      requiresApiKey: true,
    },
    configuredModel: {
      configuredModelId: "model-keyless",
      providerId: "k",
      info: { id: "claude", displayName: "Claude" },
    },
  },
];
jest.mock("jotai", () => ({ useAtomValue: () => mockEntries }));
jest.mock("@/modelManagement", () => ({
  ...jest.requireActual<typeof import("@/modelManagement/chatModel/chatModelSelection")>(
    "@/modelManagement/chatModel/chatModelSelection"
  ),
  backendPickerAtomFamily: () => "chat",
  providerRequiresApiKey: (provider: { requiresApiKey?: boolean }) =>
    provider.requiresApiKey ?? true,
  configuredModelToCustomModel: ({
    configuredModel,
  }: {
    configuredModel: { info: { id: string }; configuredModelId: string };
  }) => ({
    name: configuredModel.info.id,
    configuredModelId: configuredModel.configuredModelId,
  }),
}));
jest.mock("@/settings/model", () => ({ settingsStore: {} }));
jest.mock("@/services/keychainService", () => ({ KeychainService: { getInstance: jest.fn() } }));

describe("useChatBackendModelOptions", () => {
  describe("useChatBackendModelOptions()", () => {
    it("lists enabled models whose provider can authenticate and resolves a legacy selection (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      const { result } = renderHook(() => useChatBackendModelOptions(false));
      expect(result.current.options).toEqual([{ label: "GPT-4o", value: "model-a" }]);
      expect(result.current.resolveSelectionId("gpt-4o|openai")).toBe("model-a");
    });
    it("does not substitute the first model for a removed command selection (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      const { result } = renderHook(() => useChatBackendModelOptions(false));
      expect(result.current.resolveSelectionId("removed")).toBeUndefined();
      expect(result.current.resolveSelectionId(undefined)).toBeUndefined();
    });
  });
});
