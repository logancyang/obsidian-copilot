import { ChatModelEnableList } from "@/settings/v2/components/ChatModelEnableList";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { logError } from "@/logger";
import type { BackendConfig, ConfiguredModel, Provider } from "@/modelManagement";
import React from "react";

const setSelectedTab = jest.fn();
jest.mock("@/contexts/TabContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useTab: () => ({ setSelectedTab }),
}));
const enableModel = jest.fn().mockResolvedValue(undefined);
const disableModel = jest.fn().mockResolvedValue(undefined);
let models: ConfiguredModel[];
let providers: Record<string, Provider>;
let backends: Record<string, BackendConfig>;
jest.mock("@/agentMode", () => {
  throw new Error("Mobile model controls must not initialize desktop agents");
});
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ settingsStore: {} }));
jest.mock("@/modelManagement", () => ({
  configuredModelsAtom: "models",
  providersAtom: "providers",
  backendsAtom: "backends",
  COPILOT_PLUS_MODELS: [],
  capabilitiesFromConfiguredInfo: () => [],
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useModelManagement: () => ({ backendConfigRegistry: { enableModel, disableModel } }),
}));
jest.mock("jotai", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useAtomValue: (atom: string) => ({ models, providers, backends })[atom],
}));

describe("ChatModelEnableList", () => {
  describe("ChatModelEnableList()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      providers = {
        byok: {
          providerId: "byok",
          displayName: "OpenAI",
          providerType: "openai-compatible",
          origin: { kind: "byok", catalogProviderId: "openai" },
          addedAt: 0,
        },
        agent: {
          providerId: "agent",
          displayName: "Codex",
          providerType: "openai-compatible",
          origin: { kind: "agent", agentType: "codex" },
          addedAt: 0,
        },
      };
      models = [
        {
          configuredModelId: "a",
          providerId: "byok",
          info: { id: "model-a", displayName: "Model A" },
          configuredAt: 0,
        },
        {
          configuredModelId: "b",
          providerId: "byok",
          info: { id: "model-b", displayName: "Model B" },
          configuredAt: 0,
        },
        {
          configuredModelId: "agent",
          providerId: "agent",
          info: { id: "agent-model", displayName: "Agent model" },
          configuredAt: 0,
        },
      ];
      backends = { chat: { enabledModels: ["a"] } };
    });
    it("searches chat models and enables or disables them without desktop agents (https://github.com/Brevilabs/obsidian-copilot-private/issues/373)", () => {
      render(<ChatModelEnableList />);
      expect(screen.queryByText("Agent model")).toBeNull();
      fireEvent.click(screen.getAllByRole("switch")[0]);
      fireEvent.click(screen.getAllByRole("switch")[1]);
      expect(disableModel).toHaveBeenCalledWith("chat", "a");
      expect(enableModel).toHaveBeenCalledWith("chat", "b");
      fireEvent.change(screen.getByPlaceholderText("Search chat models…"), {
        target: { value: "model-b" },
      });
      expect(screen.queryByText("Model A")).toBeNull();
      expect(screen.getByText("Model B")).not.toBeNull();
    });
    it("opens provider settings when no chat models are configured (https://github.com/Brevilabs/obsidian-copilot-private/issues/418)", () => {
      models = [];
      backends = {};
      render(<ChatModelEnableList />);
      expect(screen.getByText("No models configured")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open provider settings" }));
      expect(setSelectedTab).toHaveBeenCalledWith("byok");
    });
    it("clears an unmatched search to recover existing models without configuration guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/418)", () => {
      render(<ChatModelEnableList />);
      fireEvent.change(screen.getByPlaceholderText("Search chat models…"), {
        target: { value: "missing" },
      });
      expect(screen.getByText("No matching models")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Open provider settings" })).toBeNull();
      fireEvent.click(screen.getByText("Clear search", { selector: "button" }));
      expect(screen.getByText("Model A")).not.toBeNull();
      expect(screen.getByText("Model B")).not.toBeNull();
      expect(enableModel).not.toHaveBeenCalled();
    });
    it("reports failed model changes without an unhandled rejection", async () => {
      const error = new Error("save failed");
      disableModel.mockRejectedValueOnce(error);
      render(<ChatModelEnableList />);
      fireEvent.click(screen.getAllByRole("switch")[0]);
      await waitFor(() =>
        expect(logError).toHaveBeenCalledWith("[QuickChat] toggle model a failed", error)
      );
    });
  });
});
