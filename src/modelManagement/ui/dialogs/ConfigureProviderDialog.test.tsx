import type { VerificationResult } from "@/modelManagement/types/runtime";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const mockVerifyCredentials = jest.fn<Promise<VerificationResult>, [string, unknown]>();
const mockSetupProvider = jest
  .fn<Promise<{ providerId: string; configuredModelIds: string[] }>, [unknown]>()
  .mockResolvedValue({ providerId: "p-new", configuredModelIds: ["cm1"] });
const mockSetApiKey = jest.fn().mockResolvedValue(undefined);
const mockClearApiKey = jest.fn().mockResolvedValue(undefined);
const mockGetApiKey = jest.fn().mockResolvedValue("existing-key");
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockBulkSet = jest.fn().mockResolvedValue([]);
const mockEnableModel = jest.fn().mockResolvedValue(undefined);
const mockRemoveRefs = jest.fn().mockResolvedValue(undefined);
const mockGetProvider = jest.fn();

jest.mock("@/modelManagement/ui/ModelManagementContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useModelManagement` hook; the name must match the export
  useModelManagement: () => ({
    adapters: { verifyCredentials: mockVerifyCredentials },
    setup: { byok: { setupProvider: mockSetupProvider } },
    providerRegistry: {
      setApiKey: mockSetApiKey,
      clearApiKey: mockClearApiKey,
      getApiKey: mockGetApiKey,
      update: mockUpdate,
    },
    configuredModelRegistry: { bulkSet: mockBulkSet },
    backendConfigRegistry: { enableModel: mockEnableModel, removeRefs: mockRemoveRefs },
    coordinator: { removeProvider: jest.fn() },
    catalogService: {
      getProvider: mockGetProvider,
      ensureLoaded: jest.fn().mockResolvedValue(undefined),
      onChange: jest.fn().mockReturnValue(() => {}),
    },
  }),
}));
// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useApp` hook; the name must match the export
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/modelManagement/state/atoms", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return {
    byokProvidersAtom: jotai.atom([
      {
        providerId: "p1",
        providerType: "anthropic",
        displayName: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
        addedAt: 0,
      },
      {
        providerId: "p-custom",
        providerType: "openai-compatible",
        displayName: "Custom",
        baseUrl: "https://proxy.example/v1",
        enableCors: true,
        origin: { kind: "byok" },
        addedAt: 0,
      },
    ]),
    configuredModelsAtom: jotai.atom([
      {
        configuredModelId: "cm1",
        providerId: "p1",
        info: {
          id: "claude-sonnet",
          displayName: "Claude Sonnet 4.5",
          limits: { context: 200000 },
        },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm2",
        providerId: "p1",
        info: { id: "claude-opus", displayName: "Claude Opus 4.5" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-custom",
        providerId: "p-custom",
        info: { id: "work-model", displayName: "Work model" },
        configuredAt: 0,
      },
    ]),
  };
});
jest.mock("@/settings/model", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return { settingsStore: jotai.createStore() };
});
jest.mock("@/components/ui/password-input", () => ({
  PasswordInput: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <input data-testid="api-key" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));
const mockListProviderModels = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("@/modelManagement/providers/adapters/listProviderModels", () => ({
  listProviderModels: (...args: unknown[]) => mockListProviderModels(...args),
}));

import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import { CUSTOM_OPENAI_DEFINITION } from "@/modelManagement/catalog/builtinDefinitions";
import { ConfigureProviderForm } from "./ConfigureProviderDialog";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetApiKey.mockResolvedValue("existing-key");
  mockListProviderModels.mockResolvedValue({ ok: true, modelIds: [] });
});

const anthropicSource: ProviderDefinition = {
  id: "anthropic",
  displayName: "Anthropic",
  providerType: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  requiresApiKey: true,
  modelInputHint: "e.g. claude-sonnet-5",
  catalogProviderId: "anthropic",
};

const openaiSource: ProviderDefinition = {
  id: "openai",
  displayName: "OpenAI",
  providerType: "openai-compatible",
  requiresApiKey: true,
  modelInputHint: "e.g. gpt-5",
  catalogProviderId: "openai",
};

const ollamaSource: ProviderDefinition = {
  id: "ollama",
  displayName: "Ollama",
  providerType: "openai-compatible",
  defaultBaseUrl: "http://localhost:11434/v1",
  requiresApiKey: false,
  modelInputHint: "e.g. llama3.2",
};

const anthropicCatalogMetadata = {
  id: "anthropic",
  displayName: "Anthropic",
  providerType: "anthropic" as const,
  defaultBaseUrl: "https://api.anthropic.com",
  models: {
    "claude-sonnet": {
      id: "claude-sonnet",
      displayName: "Claude Sonnet 4.5",
      limits: { context: 200000 },
    },
    "claude-opus": { id: "claude-opus", displayName: "Claude Opus 4.5" },
    "claude-haiku": { id: "claude-haiku", displayName: "Claude Haiku 4.5" },
    "voyage-embed": { id: "voyage-embed", displayName: "Voyage Embed", isEmbedding: true },
  },
};

function manualAddId(id: string): void {
  fireEvent.change(screen.getByTestId("model-checklist-manual-input"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

function rowCheckbox(id: string): HTMLElement {
  const row = screen.getByTestId(`model-row-${id}`);
  return within(row).getByRole("checkbox");
}

describe("ConfigureProviderDialog", () => {
  describe("ConfigureProviderForm()", () => {
    it.each([
      ["Anthropic", anthropicSource],
      ["OpenAI", openaiSource],
      ["Ollama", ollamaSource],
      ["custom OpenAI-compatible", CUSTOM_OPENAI_DEFINITION],
    ] as const)(
      "renders manual Model ID and discovery search together for %s (https://github.com/logancyang/obsidian-copilot/issues/2894)",
      (_provider, source) => {
        render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
        const modelsSection = screen.getByText("Models").parentElement;
        expect(modelsSection).not.toBeNull();
        expect(within(modelsSection!).getByTestId("model-checklist-manual-input")).toBeTruthy();
        expect(
          within(modelsSection!).getByPlaceholderText("Search available models…")
        ).toBeTruthy();
      }
    );

    it("does not list models on open while a required API key is still empty", () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      expect(mockListProviderModels).not.toHaveBeenCalled();
    });

    it("lists models on open for a keyless template and leaves them unchecked", async () => {
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["llama3.2"] });
      render(
        <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
      );
      await waitFor(() => expect(mockListProviderModels).toHaveBeenCalledTimes(1));
      expect(mockListProviderModels).toHaveBeenCalledWith(
        "openai-compatible",
        "http://localhost:11434/v1",
        expect.objectContaining({ apiKey: null })
      );
      await waitFor(() => expect(screen.getByTestId("model-row-llama3.2")).toBeTruthy());
      expect(rowCheckbox("llama3.2").getAttribute("aria-checked")).toBe("false");
    });

    it("lists models from a typed custom URL only after Test is clicked (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={jest.fn()}
        />
      );
      const baseUrlInput = screen.getByText("Base URL").parentElement?.querySelector("input");
      expect(baseUrlInput).not.toBeNull();

      fireEvent.change(baseUrlInput!, { target: { value: "h" } });
      fireEvent.change(baseUrlInput!, { target: { value: "https://work.example.com/v1" } });
      expect(mockListProviderModels).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Test" }));
      await waitFor(() => expect(mockListProviderModels).toHaveBeenCalledTimes(1));
      expect(mockListProviderModels).toHaveBeenCalledWith(
        "openai-compatible",
        "https://work.example.com/v1",
        expect.objectContaining({ apiKey: null })
      );
    });

    it("shows the source's default URL as the Base URL placeholder", () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByPlaceholderText("https://api.anthropic.com")).toBeTruthy();
    });

    it("shows the OpenAI endpoint as the Base URL placeholder when the source ships no default", async () => {
      render(
        <ConfigureProviderForm state={{ mode: "new", source: openaiSource }} onClose={jest.fn()} />
      );
      expect(screen.getByPlaceholderText("https://api.openai.com/v1")).toBeTruthy();
    });

    it("enables Save once at least one model is selected", async () => {
      render(
        <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
      );
      const save = screen.getByRole("button", { name: "Save" });
      expect(save.hasAttribute("disabled")).toBe(true);
      manualAddId("llama3.2");
      expect(save.hasAttribute("disabled")).toBe(false);
    });

    it("saves a new provider with its catalog id and the catalog metadata of the selected model", async () => {
      mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={onClose} />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-ant" } });
      manualAddId("claude-sonnet");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          catalogProviderId: "anthropic",
          providerType: "anthropic",
          displayName: "Anthropic",
          baseUrl: "https://api.anthropic.com",
          models: [
            expect.objectContaining({
              id: "claude-sonnet",
              displayName: "Claude Sonnet 4.5",
              limits: { context: 200000 },
            }),
          ],
        })
      );
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("saves a manually added id that has no catalog entry with its id as name, flagging embedding names", async () => {
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={onClose} />
      );
      manualAddId("nomic-embed-text");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalled());
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          providerType: "openai-compatible",
          models: [
            expect.objectContaining({
              id: "nomic-embed-text",
              displayName: "nomic-embed-text",
              isEmbedding: true,
            }),
          ],
        })
      );
    });

    it("saves the Quick Chat CORS choice made for a new provider (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", async () => {
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={jest.fn()}
        />
      );

      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "work-key" } });
      const baseUrlInput = screen.getByText("Base URL").parentElement?.querySelector("input");
      expect(baseUrlInput).not.toBeNull();
      fireEvent.change(baseUrlInput!, { target: { value: "https://work.example.com/v1" } });
      manualAddId("work-model");
      fireEvent.click(screen.getByRole("switch", { name: "Enable CORS" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(mockSetupProvider).toHaveBeenCalledWith(
          expect.objectContaining({ enableCors: true })
        )
      );
    });

    it("shows the error inline when listing models on open fails", async () => {
      mockListProviderModels.mockResolvedValue({ ok: false, message: "connection refused" });
      render(
        <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
      );
      expect(await screen.findByText("connection refused")).toBeTruthy();
    });

    it("offers Remove only on manually added ids, not on discovered models", async () => {
      mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
      mockListProviderModels.mockResolvedValueOnce({ ok: true, modelIds: ["claude-sonnet"] });
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-ant" } });
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
      await waitFor(() => expect(screen.getByTestId("model-row-claude-sonnet")).toBeTruthy());
      expect(screen.queryByTestId("model-row-remove-claude-sonnet")).toBeNull();
      manualAddId("my-private-model");
      expect(screen.getByTestId("model-row-remove-my-private-model")).toBeTruthy();
    });

    it("saves a custom endpoint without an API key or verification (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={onClose}
        />
      );
      const baseUrlInput = screen.getByText("Base URL").parentElement?.querySelector("input");
      expect(baseUrlInput).not.toBeNull();
      fireEvent.change(baseUrlInput!, {
        target: { value: "http://127.0.0.1:8000/v1" },
      });
      manualAddId("qwen3.8-27b");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: undefined,
          requiresApiKey: false,
          models: [expect.objectContaining({ id: "qwen3.8-27b" })],
        })
      );
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("disables Save for a custom endpoint until a Base URL is entered (https://github.com/logancyang/obsidian-copilot/issues/2895)", () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={jest.fn()}
        />
      );
      manualAddId("qwen3.8-27b");

      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      expect(mockSetupProvider).not.toHaveBeenCalled();
    });

    it("checks the models already configured for the provider when editing", async () => {
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      await waitFor(() => expect(screen.getByTestId("model-row-claude-sonnet")).toBeTruthy());
      expect(rowCheckbox("claude-sonnet").getAttribute("aria-checked")).toBe("true");
      expect(rowCheckbox("claude-opus").getAttribute("aria-checked")).toBe("true");
    });

    it("leaves newly discovered models unchecked when editing", async () => {
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["claude-haiku"] });
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      await waitFor(() => expect(screen.getByTestId("model-row-claude-haiku")).toBeTruthy());
      expect(rowCheckbox("claude-haiku").getAttribute("aria-checked")).toBe("false");
    });

    it("tests the stored key without saving it", async () => {
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      fireEvent.click(await screen.findByRole("button", { name: "Test" }));
      await waitFor(() => expect(mockVerifyCredentials).toHaveBeenCalled());
      expect(mockGetApiKey).toHaveBeenCalledWith("p1");
      expect(mockSetApiKey).not.toHaveBeenCalled();
    });

    it("tests the edited Base URL rather than the saved one", async () => {
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      const baseUrlInput = await screen.findByPlaceholderText("https://api.anthropic.com");
      fireEvent.change(baseUrlInput, { target: { value: "https://proxy.example.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
      await waitFor(() => expect(mockVerifyCredentials).toHaveBeenCalled());
      const [providerType, ctx] = mockVerifyCredentials.mock.calls[0];
      expect(providerType).toBe("anthropic");
      expect((ctx as { provider: { baseUrl?: string } }).provider.baseUrl).toBe(
        "https://proxy.example.com"
      );
    });

    it("removes a deselected model from every backend on save", async () => {
      mockBulkSet.mockResolvedValue(["cm1"]);
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />
      );
      await waitFor(() =>
        expect(rowCheckbox("claude-opus").getAttribute("aria-checked")).toBe("true")
      );
      fireEvent.click(rowCheckbox("claude-opus"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockRemoveRefs).toHaveBeenCalledWith(["cm2"]));
      expect(mockBulkSet).toHaveBeenCalledWith("p1", [
        expect.objectContaining({ id: "claude-sonnet" }),
      ]);
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("enrolls only newly added chat models on save, skipping embeddings and leaving existing models as they were", async () => {
      mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
      mockListProviderModels.mockResolvedValue({
        ok: true,
        modelIds: ["claude-haiku", "voyage-embed"],
      });
      mockBulkSet.mockResolvedValue(["cm1", "cm2", "cm-haiku", "cm-embed"]);
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />
      );
      await waitFor(() => expect(screen.getByTestId("model-row-claude-haiku")).toBeTruthy());
      fireEvent.click(rowCheckbox("claude-haiku"));
      fireEvent.click(rowCheckbox("voyage-embed"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      for (const backend of ["chat", "opencode"]) {
        expect(mockEnableModel).toHaveBeenCalledWith(backend, "cm-haiku");
      }
      expect(mockEnableModel).not.toHaveBeenCalledWith(expect.anything(), "cm-embed");
      expect(mockEnableModel).not.toHaveBeenCalledWith(expect.anything(), "cm1");
      expect(mockEnableModel).not.toHaveBeenCalledWith(expect.anything(), "cm2");
    });

    it("lists models on open using the saved key when editing a custom provider", async () => {
      mockGetApiKey.mockResolvedValue("saved-secret");
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["gpt-x"] });
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      await waitFor(() => expect(mockListProviderModels).toHaveBeenCalled());
      expect(mockListProviderModels).toHaveBeenCalledWith(
        "openai-compatible",
        "https://proxy.example/v1",
        expect.objectContaining({ apiKey: "saved-secret" })
      );
    });

    it("reports a CORS-only change as saved only after it is persisted (https://github.com/logancyang/obsidian-copilot/issues/3147) (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", async () => {
      const onSaved = jest.fn();
      let finishUpdate!: () => void;
      mockUpdate.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishUpdate = resolve;
          })
      );
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
          onSaved={onSaved}
        />
      );

      const corsSwitch = await screen.findByRole("switch", { name: "Enable CORS" });
      expect(corsSwitch.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(corsSwitch);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith(
          "p-custom",
          expect.objectContaining({ enableCors: false })
        )
      );
      expect(onSaved).not.toHaveBeenCalled();
      act(() => {
        finishUpdate();
      });
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });

    it("offers Remove on saved custom models but not on saved catalog models", async () => {
      mockGetProvider.mockReturnValue({
        ...anthropicCatalogMetadata,
        models: { "claude-sonnet": anthropicCatalogMetadata.models["claude-sonnet"] },
      });
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["claude-sonnet"] });
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      await waitFor(() => expect(screen.getByTestId("model-row-claude-sonnet")).toBeTruthy());
      await waitFor(() => expect(screen.getByTestId("model-row-claude-opus")).toBeTruthy());
      expect(screen.queryByTestId("model-row-remove-claude-sonnet")).toBeNull();
      expect(screen.getByTestId("model-row-remove-claude-opus")).toBeTruthy();
    });

    it("hides a removed custom model immediately and deletes it on save", async () => {
      mockGetProvider.mockReturnValue(undefined);
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: [] });
      mockBulkSet.mockResolvedValue(["cm1"]);
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />
      );
      await waitFor(() => expect(screen.getByTestId("model-row-remove-claude-opus")).toBeTruthy());
      fireEvent.click(screen.getByTestId("model-row-remove-claude-opus"));
      expect(screen.queryByTestId("model-row-claude-opus")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockRemoveRefs).toHaveBeenCalledWith(["cm2"]));
      expect(mockBulkSet).toHaveBeenCalledWith("p1", [
        expect.objectContaining({ id: "claude-sonnet" }),
      ]);
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("empties the key field on Clear without closing the dialog or deleting the stored key yet", async () => {
      mockGetApiKey.mockResolvedValue("saved-secret");
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />
      );
      const clear = await screen.findByTestId("api-key-clear");
      fireEvent.click(clear);
      await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("api-key").value).toBe(""));
      expect(mockClearApiKey).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId("api-key-clear")).toBeNull();
    });

    it("disables Save after clearing a required-key provider's key", async () => {
      mockGetApiKey.mockResolvedValue("saved-secret");
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      fireEvent.click(await screen.findByTestId("api-key-clear"));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
      );
    });

    it("keeps the user's selection unchanged when models are listed again after Test", async () => {
      mockListProviderModels.mockResolvedValueOnce({ ok: true, modelIds: ["a", "b"] });
      render(
        <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
      );
      await waitFor(() => expect(screen.getByTestId("model-row-a")).toBeTruthy());
      expect(rowCheckbox("a").getAttribute("aria-checked")).toBe("false");
      expect(rowCheckbox("b").getAttribute("aria-checked")).toBe("false");

      fireEvent.click(rowCheckbox("a"));
      expect(rowCheckbox("a").getAttribute("aria-checked")).toBe("true");

      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      mockListProviderModels.mockResolvedValueOnce({ ok: true, modelIds: ["a", "b"] });
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
      await waitFor(() => expect(mockListProviderModels).toHaveBeenCalledTimes(2));
      expect(rowCheckbox("a").getAttribute("aria-checked")).toBe("true");
      expect(rowCheckbox("b").getAttribute("aria-checked")).toBe("false");
    });

    it("shows nothing and lists no models while the provider being edited cannot be found", () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "missing" }}
          onClose={jest.fn()}
        />
      );
      expect(screen.queryByTestId("model-checklist-manual-input")).toBeNull();
      expect(screen.queryByText(/^Configure/)).toBeNull();
      expect(mockListProviderModels).not.toHaveBeenCalled();
    });

    it("shows the source's model id hint as the manual input placeholder", () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByPlaceholderText("e.g. gpt-5.5")).toBeTruthy();
    });

    it("fails Test with a prompt to enter a key, without contacting the provider, when a required key is empty", async () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
      expect(await screen.findByText("Enter an API key to verify this provider.")).toBeTruthy();
    });

    it("disables Save for a required-key provider with no key", () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      manualAddId("claude-sonnet");
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    });

    it("verifies an untested key on Save and, when it is invalid, does not save and disables Save", async () => {
      mockVerifyCredentials.mockResolvedValue({
        ok: false,
        code: "invalid_api_key",
        message: "Authentication failed",
        checkedAt: 1,
      });
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: anthropicSource }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-bad" } });
      manualAddId("claude-sonnet");
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockVerifyCredentials).toHaveBeenCalled());
      expect(mockSetupProvider).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
      );
    });

    it("still saves when verification is inconclusive because of a network error", async () => {
      mockVerifyCredentials.mockResolvedValue({
        ok: false,
        code: "network",
        message: "connection refused",
        checkedAt: 1,
      });
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={onClose} />
      );
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-maybe" } });
      manualAddId("claude-sonnet");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it("reports a changed key and endpoint as saved only after both are persisted (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      const onSaved = jest.fn();
      let finishUpdate!: () => void;
      mockUpdate.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishUpdate = resolve;
          })
      );
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
          onSaved={onSaved}
        />
      );
      fireEvent.change(await screen.findByTestId("api-key"), { target: { value: "new-key" } });
      fireEvent.change(screen.getByDisplayValue("https://proxy.example/v1"), {
        target: { value: "https://new.example/v1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith(
          "p-custom",
          expect.objectContaining({ baseUrl: "https://new.example/v1" })
        )
      );
      expect(mockSetApiKey).toHaveBeenCalledWith("p-custom", "new-key");
      expect(onSaved).not.toHaveBeenCalled();
      act(() => {
        finishUpdate();
      });
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });

    it("pre-fills the saved key when editing and saves without rewriting or re-verifying it", async () => {
      mockGetApiKey.mockResolvedValue("saved-secret");
      mockBulkSet.mockResolvedValue(["cm1", "cm2"]);
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />
      );
      const input = await screen.findByTestId<HTMLInputElement>("api-key");
      expect(input.value).toBe("saved-secret");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(mockSetApiKey).not.toHaveBeenCalled();
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
    });

    it("tests and saves a keyless provider with an empty key field", async () => {
      mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
      const onClose = jest.fn();
      const onSaved = jest.fn();
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: ollamaSource }}
          onClose={onClose}
          onSaved={onSaved}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
      await waitFor(() => expect(mockVerifyCredentials).toHaveBeenCalled());
      manualAddId("llama3.2");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
      expect(mockSetupProvider).toHaveBeenCalledWith(
        expect.objectContaining({ requiresApiKey: false })
      );
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });
});
