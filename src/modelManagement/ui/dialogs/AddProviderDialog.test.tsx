import type { CatalogProvider } from "@/modelManagement/types/catalog";
import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { AddProviderContent } from "./AddProviderDialog";

// Radix Tooltip/Dialog portals resolve `activeDocument` at render time.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function makeCatalog(id: string, displayName: string): CatalogProvider {
  return {
    id,
    displayName,
    providerType: id === "anthropic" ? "anthropic" : "openai-compatible",
    models: {},
  };
}

const catalog: CatalogProvider[] = [
  makeCatalog("anthropic", "Anthropic"),
  makeCatalog("openai", "OpenAI"),
  makeCatalog("google", "Google"),
  makeCatalog("groq", "Groq"),
];

const localTemplates: ProviderDefinition[] = [
  {
    id: "ollama",
    displayName: "Ollama",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. llama3.2",
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. qwen2.5",
  },
];

const customTemplate: ProviderDefinition = {
  id: "custom-openai-compatible",
  displayName: "Custom OpenAI-compatible",
  providerType: "openai-compatible",
  requiresApiKey: true,
  modelInputHint: "e.g. gpt-5.5",
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof AddProviderContent>> = {}) {
  const props: React.ComponentProps<typeof AddProviderContent> = {
    catalogProviders: catalog,
    localTemplates,
    customTemplate,
    onPick: jest.fn(),
    ...overrides,
  };
  render(<AddProviderContent {...props} />);
  return props;
}

describe("AddProviderDialog", () => {
  it("splits providers into Recommended and More sections", () => {
    renderDialog();
    expect(screen.getByTestId("add-provider-recommended")).toBeTruthy();
    expect(screen.getByTestId("add-provider-card-anthropic")).toBeTruthy();
    expect(screen.getByTestId("add-provider-card-openai")).toBeTruthy();
    expect(screen.getByTestId("add-provider-card-google")).toBeTruthy();
    expect(screen.getByTestId("add-provider-more")).toBeTruthy();
    expect(screen.getByTestId("add-provider-card-groq")).toBeTruthy();
  });

  it("filters by search query across catalog and local groups", () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Search providers…"), {
      target: { value: "groq" },
    });
    expect(screen.queryByTestId("add-provider-card-anthropic")).toBeNull();
    expect(screen.queryByTestId("add-provider-template-ollama")).toBeNull();
    expect(screen.getByTestId("add-provider-card-groq")).toBeTruthy();
  });

  it("emits a catalog-backed ProviderDefinition when a catalog row is picked", () => {
    const onPick = jest.fn();
    renderDialog({ onPick });
    fireEvent.click(screen.getByTestId("add-provider-card-anthropic"));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "anthropic",
        providerType: "anthropic",
        catalogProviderId: "anthropic",
        requiresApiKey: true,
      })
    );
  });

  it("includes a per-provider-type manual-add hint on catalog-backed picks", () => {
    const onPick = jest.fn();
    renderDialog({ onPick });
    fireEvent.click(screen.getByTestId("add-provider-card-anthropic"));
    expect(onPick.mock.calls[0][0].modelInputHint).toMatch(/claude/i);
  });

  it("shows local runners in their own group on the first screen", () => {
    renderDialog();
    expect(screen.getByTestId("add-provider-local")).toBeTruthy();
    expect(screen.getByTestId("add-provider-template-ollama")).toBeTruthy();
    expect(screen.getByTestId("add-provider-template-lmstudio")).toBeTruthy();
  });

  it("emits the verbatim ProviderDefinition (no catalog id) for a local template pick", () => {
    const onPick = jest.fn();
    renderDialog({ onPick });
    fireEvent.click(screen.getByTestId("add-provider-template-ollama"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "ollama" }));
    expect(onPick.mock.calls[0][0].catalogProviderId).toBeUndefined();
  });

  it("emits the custom-openai-compatible definition from the CTA", () => {
    const onPick = jest.fn();
    renderDialog({ onPick });
    fireEvent.click(screen.getByTestId("add-provider-custom-cta"));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "custom-openai-compatible" })
    );
    expect(onPick.mock.calls[0][0].catalogProviderId).toBeUndefined();
  });

  it("activates the custom-provider CTA via Enter key", () => {
    const onPick = jest.fn();
    renderDialog({ onPick });
    fireEvent.keyDown(screen.getByTestId("add-provider-custom-cta"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "custom-openai-compatible" })
    );
  });

  it("activates the custom-provider CTA via Space key", () => {
    const onPick = jest.fn();
    renderDialog({ onPick });
    fireEvent.keyDown(screen.getByTestId("add-provider-custom-cta"), { key: " " });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "custom-openai-compatible" })
    );
  });
});
