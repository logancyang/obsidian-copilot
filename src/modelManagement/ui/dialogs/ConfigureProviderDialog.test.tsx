import type { VerificationResult } from "@/modelManagement/types/runtime";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    catalogService: { getProvider: mockGetProvider },
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
        // Catalog-less edit-mode row (template-origin); used to assert the
        // fetch path works with a saved key when the user hasn't re-typed it.
        providerId: "p-custom",
        providerType: "openai-compatible",
        displayName: "Custom",
        baseUrl: "https://proxy.example/v1",
        origin: { kind: "byok" },
        addedAt: 0,
      },
      {
        // Risk R1 fixture: a saved model carries a vision override the catalog
        // metadata disagrees with. Re-saving must preserve the saved caps.
        providerId: "p-vision",
        providerType: "anthropic",
        displayName: "Vision Provider",
        baseUrl: "https://api.anthropic.com",
        origin: { kind: "byok", catalogProviderId: "vision" },
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
        // Risk R1: saved snapshot has vision (image input) — the catalog
        // metadata for the same id lacks it (see visionCatalogMetadata).
        configuredModelId: "cm-vision",
        providerId: "p-vision",
        info: {
          id: "seer",
          displayName: "Seer",
          modalities: { input: ["text", "image"], output: ["text"] },
        },
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

const customSource: ProviderDefinition = {
  id: "custom-openai-compatible",
  displayName: "Custom OpenAI-compatible",
  providerType: "openai-compatible",
  requiresApiKey: true,
  modelInputHint: "e.g. gpt-5.5",
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

// R1: the catalog masks the saved vision (no image input) for the same id, so
// the catalog-first resolver would drop a prior override absent the overlay fix.
const visionCatalogMetadata = {
  id: "vision",
  displayName: "Vision Provider",
  providerType: "anthropic" as const,
  defaultBaseUrl: "https://api.anthropic.com",
  models: {
    seer: { id: "seer", displayName: "Seer", modalities: { input: ["text"], output: ["text"] } },
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

describe("ConfigureProviderForm (new mode)", () => {
  it("skips the mount fetch when the source requires an API key and the field is empty", () => {
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={jest.fn()} />
    );
    expect(mockListProviderModels).not.toHaveBeenCalled();
  });

  it("fires the mount fetch for a key-less template (no auth required)", async () => {
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
    // Discovered ids appear as unchecked candidates; user opts in.
    await waitFor(() => expect(screen.getByTestId("model-row-llama3.2")).toBeTruthy());
    expect(rowCheckbox("llama3.2").getAttribute("aria-checked")).toBe("false");
  });

  it("uses the source default URL as the input placeholder", () => {
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={jest.fn()} />
    );
    expect(screen.getByPlaceholderText("https://api.anthropic.com")).toBeTruthy();
  });

  it("falls back to a known default endpoint when the source ships none", async () => {
    // OpenAI catalog has no defaultBaseUrl; the known-default lookup fills in.
    render(
      <ConfigureProviderForm state={{ mode: "new", source: openaiSource }} onClose={jest.fn()} />
    );
    expect(screen.getByPlaceholderText("https://api.openai.com/v1")).toBeTruthy();
  });

  it("Save is gated only on a non-empty selection", async () => {
    render(
      <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    manualAddId("llama3.2");
    expect(save.hasAttribute("disabled")).toBe(false);
  });

  it("calls setupProvider with the catalog id + enriched model metadata", async () => {
    mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
    mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
    const onClose = jest.fn();
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={onClose} />
    );
    // A required-key provider can't save without a key, so supply one.
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
          // The manually-added id matches a catalog entry, so the saved
          // ModelInfo carries the enriched displayName + limits.
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

  it("synthesizes minimal ModelInfo for a manual id with no catalog entry", async () => {
    const onClose = jest.fn();
    render(
      <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={onClose} />
    );
    manualAddId("nomic-embed-text");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSetupProvider).toHaveBeenCalled());
    expect(mockSetupProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        // No catalogProviderId for a template-origin save.
        providerType: "openai-compatible",
        models: [
          expect.objectContaining({
            id: "nomic-embed-text",
            displayName: "nomic-embed-text",
            // Embedding heuristic kicks in for the embed-named id.
            isEmbedding: true,
          }),
        ],
      })
    );
  });

  it("re-fetches the model list after a successful API key test", async () => {
    mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
    mockListProviderModels
      // mount-skip (requiresApiKey + no key); post-test fetch returns ids
      .mockResolvedValueOnce({ ok: true, modelIds: ["claude-sonnet"] });
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={jest.fn()} />
    );

    fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-ant" } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(mockListProviderModels).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("model-row-claude-sonnet")).toBeTruthy());
    // Fetched ids are candidates only — user must explicitly tick them.
    expect(rowCheckbox("claude-sonnet").getAttribute("aria-checked")).toBe("false");
  });

  it("surfaces a fetch error inline (mount fetch failure)", async () => {
    mockListProviderModels.mockResolvedValue({ ok: false, message: "connection refused" });
    render(
      <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
    );
    expect(await screen.findByText("connection refused")).toBeTruthy();
  });

  it("only manually-added ids get an X (remove) button — discovered rows do not", async () => {
    mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
    mockListProviderModels.mockResolvedValueOnce({ ok: true, modelIds: ["claude-sonnet"] });
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={jest.fn()} />
    );
    // Trigger a fetch by typing an API key + Test.
    mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
    fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-ant" } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByTestId("model-row-claude-sonnet")).toBeTruthy());
    // Discovered (live-fetched + catalog-known) row → no X.
    expect(screen.queryByTestId("model-row-remove-claude-sonnet")).toBeNull();
    // Manually-typed id → X visible.
    manualAddId("my-private-model");
    expect(screen.getByTestId("model-row-remove-my-private-model")).toBeTruthy();
  });

  it("ignores adapters that don't support listing (azure / bedrock)", async () => {
    mockListProviderModels.mockResolvedValue(null);
    render(
      <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(mockListProviderModels).toHaveBeenCalled());
    // No error chrome rendered.
    expect(screen.queryByText(/Listing not supported/i)).toBeNull();
  });
});

describe("ConfigureProviderForm (edit mode)", () => {
  it("seeds the selection from existing configured models", async () => {
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByTestId("model-row-claude-sonnet")).toBeTruthy());
    expect(rowCheckbox("claude-sonnet").getAttribute("aria-checked")).toBe("true");
    expect(rowCheckbox("claude-opus").getAttribute("aria-checked")).toBe("true");
  });

  it("does not auto-check newly fetched ids (no silent subscription)", async () => {
    // Mount fetch returns claude-haiku as a new id, on top of the two seeded
    // from existing configured models.
    mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["claude-haiku"] });
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByTestId("model-row-claude-haiku")).toBeTruthy());
    expect(rowCheckbox("claude-haiku").getAttribute("aria-checked")).toBe("false");
  });

  it("verifies without writing the API key (Test never persists)", async () => {
    mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
    );
    // The body mounts once the gate resolves the saved key.
    fireEvent.click(await screen.findByRole("button", { name: "Test" }));
    await waitFor(() => expect(mockVerifyCredentials).toHaveBeenCalled());
    expect(mockGetApiKey).toHaveBeenCalledWith("p1");
    expect(mockSetApiKey).not.toHaveBeenCalled();
  });

  it("Test verifies the edited base URL, not the persisted one", async () => {
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

  it("removes de-selected models from every backend on save", async () => {
    mockBulkSet.mockResolvedValue(["cm1"]);
    const onClose = jest.fn();
    render(<ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />);
    // Wait for seed to apply.
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

  it("auto-enrolls only newly-added chat models — skips embeddings, never re-enables existing", async () => {
    mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
    mockListProviderModels.mockResolvedValue({
      ok: true,
      modelIds: ["claude-haiku", "voyage-embed"],
    });
    mockBulkSet.mockResolvedValue(["cm1", "cm2", "cm-haiku", "cm-embed"]);
    const onClose = jest.fn();
    render(<ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />);
    // Wait for the fetched rows to appear, then check them.
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

  it("Mount fetch uses the saved key (catalog-less edit row)", async () => {
    mockGetApiKey.mockResolvedValue("saved-secret");
    mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["gpt-x"] });
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p-custom" }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(mockListProviderModels).toHaveBeenCalled());
    expect(mockListProviderModels).toHaveBeenCalledWith(
      "openai-compatible",
      "https://proxy.example/v1",
      expect.objectContaining({ apiKey: "saved-secret" })
    );
  });

  it("X button hidden on saved catalog models but visible on saved-custom rows", async () => {
    // Catalog known → claude-sonnet (in metadata) is discovered; claude-opus
    // (not in metadata, not in current fetch) is custom-added.
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
    // Discovered → no X.
    expect(screen.queryByTestId("model-row-remove-claude-sonnet")).toBeNull();
    // Catalog-unknown + not in live fetch → custom → X visible.
    expect(screen.getByTestId("model-row-remove-claude-opus")).toBeTruthy();
  });

  it("clicking X on a saved-custom row hides it and persists removal on save", async () => {
    // Catalog-less provider → both saved rows are custom (not in catalog,
    // not in live fetch).
    mockGetProvider.mockReturnValue(undefined);
    mockListProviderModels.mockResolvedValue({ ok: true, modelIds: [] });
    mockBulkSet.mockResolvedValue(["cm1"]);
    const onClose = jest.fn();
    render(<ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId("model-row-remove-claude-opus")).toBeTruthy());
    fireEvent.click(screen.getByTestId("model-row-remove-claude-opus"));
    // Row is gone from the candidate pool.
    expect(screen.queryByTestId("model-row-claude-opus")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // Save removes the removed-existing id from backend refs and bulkSets
    // only the remaining (still-selected) infos.
    await waitFor(() => expect(mockRemoveRefs).toHaveBeenCalledWith(["cm2"]));
    expect(mockBulkSet).toHaveBeenCalledWith("p1", [
      expect.objectContaining({ id: "claude-sonnet" }),
    ]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Clear empties the field, keeps the dialog open, and persists nothing immediately", async () => {
    mockGetApiKey.mockResolvedValue("saved-secret");
    const onClose = jest.fn();
    render(<ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />);
    const clear = await screen.findByTestId("api-key-clear");
    fireEvent.click(clear);
    // Field is wiped, but the keychain isn't touched and the dialog stays open —
    // the removal is staged for Save, like every other field.
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("api-key").value).toBe(""));
    expect(mockClearApiKey).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Nothing left to clear → the button is gone.
    expect(screen.queryByTestId("api-key-clear")).toBeNull();
  });

  it("disables Save after clearing a required-key provider's key", async () => {
    mockGetApiKey.mockResolvedValue("saved-secret");
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
    );
    // p1 (anthropic, byok + catalogProviderId) requires a key and seeds two
    // selected models, so the empty field is the only thing blocking Save.
    fireEvent.click(await screen.findByTestId("api-key-clear"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
    );
  });
});

describe("ConfigureProviderForm (Advanced capability overrides)", () => {
  function expandAdvanced(): void {
    fireEvent.click(screen.getByTestId("advanced-toggle"));
  }

  it("lists each selected non-embedding model with vision + reasoning toggles", async () => {
    mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByTestId("model-row-claude-sonnet")).toBeTruthy());
    expandAdvanced();
    expect(screen.getByTestId("advanced-row-claude-sonnet")).toBeTruthy();
    expect(screen.getByTestId("advanced-vision-claude-sonnet")).toBeTruthy();
    expect(screen.getByTestId("advanced-reasoning-claude-sonnet")).toBeTruthy();
  });

  it("shows an empty hint when no models are selected", async () => {
    mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["llama3.2"] });
    render(
      <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByTestId("model-row-llama3.2")).toBeTruthy());
    expandAdvanced();
    expect(screen.getByTestId("advanced-empty")).toBeTruthy();
  });

  it("excludes embedding models from the panel", async () => {
    mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
    mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["voyage-embed"] });
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByTestId("model-row-voyage-embed")).toBeTruthy());
    fireEvent.click(rowCheckbox("voyage-embed"));
    expandAdvanced();
    expect(screen.queryByTestId("advanced-row-voyage-embed")).toBeNull();
  });

  it("persists a vision override onto a catalog model that lacked it", async () => {
    mockGetProvider.mockReturnValue(anthropicCatalogMetadata);
    mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
    const onClose = jest.fn();
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={onClose} />
    );
    fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-ant" } });
    manualAddId("claude-sonnet");
    expandAdvanced();
    // claude-sonnet has no vision in the catalog — turn it on.
    fireEvent.click(screen.getByTestId("advanced-vision-claude-sonnet"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSetupProvider).toHaveBeenCalled());
    const saved = mockSetupProvider.mock.calls[0][0] as { models: Array<{ id: string }> };
    const seer = saved.models.find((m) => m.id === "claude-sonnet") as {
      modalities?: { input?: string[] };
    };
    expect(seer.modalities?.input).toContain("image");
  });

  it("R1: re-saving an untouched model preserves a saved vision override against catalog precedence", async () => {
    // p-vision's saved model has image input; its catalog metadata (resolved
    // via getProvider) does not. The user never opens Advanced — the overlay
    // must still re-assert the saved caps.
    mockGetProvider.mockReturnValue(visionCatalogMetadata);
    mockBulkSet.mockResolvedValue(["cm-vision"]);
    const onClose = jest.fn();
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p-vision" }} onClose={onClose} />
    );
    await waitFor(() => expect(rowCheckbox("seer").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockBulkSet).toHaveBeenCalled());
    const [, infos] = mockBulkSet.mock.calls[0] as [string, Array<{ id: string }>];
    const seer = infos.find((m) => m.id === "seer") as { modalities?: { input?: string[] } };
    expect(seer.modalities?.input).toContain("image");
  });

  it("R1: toggling vision off on a saved-vision model drops image on re-save", async () => {
    mockGetProvider.mockReturnValue(visionCatalogMetadata);
    mockBulkSet.mockResolvedValue(["cm-vision"]);
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "p-vision" }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByTestId("model-row-seer")).toBeTruthy());
    expandAdvanced();
    // The toggle seeds from the SAVED caps (vision on), so a click turns it off.
    const visionToggle = screen.getByTestId("advanced-vision-seer");
    expect(visionToggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(visionToggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockBulkSet).toHaveBeenCalled());
    const [, infos] = mockBulkSet.mock.calls[0] as [string, Array<{ id: string }>];
    const seer = infos.find((m) => m.id === "seer") as { modalities?: { input?: string[] } };
    expect(seer.modalities?.input ?? []).not.toContain("image");
  });
});

describe("ConfigureProviderForm (re-fetch curation)", () => {
  it("re-fetching never toggles selection — discovered ids are candidates only", async () => {
    // 1st fetch returns "a","b" — both appear as unchecked candidates.
    mockListProviderModels.mockResolvedValueOnce({ ok: true, modelIds: ["a", "b"] });
    render(
      <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={jest.fn()} />
    );
    await waitFor(() => expect(screen.getByTestId("model-row-a")).toBeTruthy());
    expect(rowCheckbox("a").getAttribute("aria-checked")).toBe("false");
    expect(rowCheckbox("b").getAttribute("aria-checked")).toBe("false");

    // User explicitly ticks "a".
    fireEvent.click(rowCheckbox("a"));
    expect(rowCheckbox("a").getAttribute("aria-checked")).toBe("true");

    // A subsequent Test success triggers a refetch returning the same ids;
    // the user's selection state must be preserved verbatim — "a" stays
    // ticked, "b" stays unchecked, no row duplication.
    mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
    mockListProviderModels.mockResolvedValueOnce({ ok: true, modelIds: ["a", "b"] });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(mockListProviderModels).toHaveBeenCalledTimes(2));
    expect(rowCheckbox("a").getAttribute("aria-checked")).toBe("true");
    expect(rowCheckbox("b").getAttribute("aria-checked")).toBe("false");
  });
});

describe("ConfigureProviderForm (hydration gate)", () => {
  it("holds back the stateful body until the provider row resolves", () => {
    // Unknown providerId → `provider` never resolves from the atom, so the
    // gate must render its placeholder and never mount the body (whose
    // useState initializers would otherwise seed from blank values and let
    // the user Save them).
    render(
      <ConfigureProviderForm state={{ mode: "edit", providerId: "missing" }} onClose={jest.fn()} />
    );
    expect(screen.queryByTestId("model-checklist-manual-input")).toBeNull();
    expect(screen.queryByText(/^Configure/)).toBeNull();
    // No fetch fires while gated.
    expect(mockListProviderModels).not.toHaveBeenCalled();
  });
});

// Use the customSource definition somewhere so it isn't flagged as unused;
// covers the dialog's behavior for a catalog-less custom source.
describe("ConfigureProviderForm (custom-openai source)", () => {
  it("shows the default 'Add a model id' / source-supplied hint in the manual input", () => {
    render(
      <ConfigureProviderForm state={{ mode: "new", source: customSource }} onClose={jest.fn()} />
    );
    expect(screen.getByPlaceholderText("e.g. gpt-5.5")).toBeTruthy();
  });
});

describe("ConfigureProviderForm (credential verification + save gating)", () => {
  it("A1: a required-key provider with an empty field fails Test without probing", async () => {
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    // No network probe — the guard short-circuits so a public /models 200
    // can't read as "Verified".
    expect(mockVerifyCredentials).not.toHaveBeenCalled();
    expect(await screen.findByText("Enter an API key to verify this provider.")).toBeTruthy();
  });

  it("B2: Save is disabled for a required-key provider with no key", () => {
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={jest.fn()} />
    );
    manualAddId("claude-sonnet");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("B2: an untested invalid key auto-verifies on Save, aborts, and blocks further Save", async () => {
    mockVerifyCredentials.mockResolvedValue({
      ok: false,
      code: "invalid_api_key",
      message: "Authentication failed",
      checkedAt: 1,
    });
    render(
      <ConfigureProviderForm state={{ mode: "new", source: anthropicSource }} onClose={jest.fn()} />
    );
    fireEvent.change(screen.getByTestId("api-key"), { target: { value: "sk-bad" } });
    manualAddId("claude-sonnet");
    // Untested key → Save is enabled, but Save auto-verifies first.
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockVerifyCredentials).toHaveBeenCalled());
    expect(mockSetupProvider).not.toHaveBeenCalled();
    // The conclusive failure now disables Save.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
    );
  });

  it("B2: an inconclusive verification (network) does not block Save", async () => {
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
    // Offline users aren't stranded — the provider still saves.
    await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("B1/B2: edit mode pre-fills the saved key and saves without re-typing or re-writing it", async () => {
    mockGetApiKey.mockResolvedValue("saved-secret");
    mockBulkSet.mockResolvedValue(["cm1", "cm2"]);
    const onClose = jest.fn();
    render(<ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={onClose} />);
    // The field is seeded with the stored key (visible, masked by PasswordInput).
    const input = await screen.findByTestId<HTMLInputElement>("api-key");
    expect(input.value).toBe("saved-secret");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Unchanged key → no keychain churn and no re-verification.
    expect(mockSetApiKey).not.toHaveBeenCalled();
    expect(mockVerifyCredentials).not.toHaveBeenCalled();
  });

  it("B2: a keyless provider (requiresApiKey:false) Tests and Saves with an empty field", async () => {
    mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
    const onClose = jest.fn();
    render(
      <ConfigureProviderForm state={{ mode: "new", source: ollamaSource }} onClose={onClose} />
    );
    // Test with an empty field probes the endpoint (no required-key guard).
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(mockVerifyCredentials).toHaveBeenCalled());
    manualAddId("llama3.2");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSetupProvider).toHaveBeenCalledTimes(1));
    expect(mockSetupProvider).toHaveBeenCalledWith(
      expect.objectContaining({ requiresApiKey: false })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
