import { renderHook } from "@testing-library/react";
import type { App } from "obsidian";
import { useResolvedChatBackendModel } from "./useResolvedChatBackendModel";

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
  backendPickerAtomFamily: () => "chat",
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

describe("useResolvedChatBackendModel", () => {
  describe("useResolvedChatBackendModel()", () => {
    it("resolves an explicitly selected legacy model without fallback", () => {
      const { result } = renderHook(() =>
        useResolvedChatBackendModel({} as App, "gpt-4o|openai", false)
      );
      expect(result.current).toEqual({ name: "gpt-4o", configuredModelId: "model-a" });
    });
    it("returns no model for a stale strict selection (https://github.com/Brevilabs/obsidian-copilot-private/issues/616)", () => {
      const { result } = renderHook(() => useResolvedChatBackendModel({} as App, "removed", false));
      expect(result.current).toBeNull();
    });
    it("retains first-model fallback for chat callers", () => {
      const { result } = renderHook(() => useResolvedChatBackendModel({} as App, undefined));
      expect(result.current?.configuredModelId).toBe("model-a");
    });
  });
});
