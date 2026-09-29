import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ByokGlobalTable, type ByokTableGroup } from "./ByokGlobalTable";
import { ModelManagementProvider } from "@/modelManagement/ui/ModelManagementContext";
import { createModelManagement } from "@/modelManagement/createModelManagement";
import { AppContext } from "@/context";
import type { App } from "obsidian";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

const mockApp = {
  vault: { adapter: { exists: jest.fn() } },
} as unknown as App;

const api = createModelManagement({ app: mockApp });

const group: ByokTableGroup = {
  provider: {
    providerId: "p1",
    providerType: "anthropic",
    displayName: "Anthropic",
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
    requiresApiKey: true,
    apiKeyKeychainId: "key1",
  },
  verification: { ok: true, checkedAt: 0 },
  models: [
    {
      configuredModelId: "m1",
      providerId: "p1",
      info: {
        id: "claude-sonnet",
        displayName: "Claude Sonnet 4.5",
        limits: { context: 200000 },
        releaseDate: "2025-09-01",
      },
      configuredAt: 0,
    },
    {
      configuredModelId: "m2",
      providerId: "p1",
      info: { id: "claude-opus", displayName: "Claude Opus 4.5" },
      configuredAt: 0,
    },
  ],
};

const renderWithProvider = (ui: React.ReactElement) =>
  render(
    <AppContext.Provider value={mockApp}>
      <ModelManagementProvider api={api}>{ui}</ModelManagementProvider>
    </AppContext.Provider>
  );

describe("ByokGlobalTable", () => {
  describe("ByokGlobalTable()", () => {
    it("shows the empty state when there are no groups", () => {
      renderWithProvider(
        <ByokGlobalTable groups={[]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByTestId("byok-table-empty")).toBeTruthy();
    });

    it("renders the provider name and model rows when expanded", () => {
      renderWithProvider(
        <ByokGlobalTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("Anthropic")).toBeTruthy();

      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
      expect(screen.getByText("Claude Opus 4.5")).toBeTruthy();
    });

    it("shows model count and status badge", () => {
      renderWithProvider(
        <ByokGlobalTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("2 models")).toBeTruthy();
      const badge = screen.getByText("Verified");
      expect(badge.className).toContain("tw-bg-success");
      expect(badge.className).toContain("tw-text-success");
    });

    it("shows a missing-key result even when configuration alone cannot verify it (https://github.com/logancyang/obsidian-copilot/issues/3147)", () => {
      const noKeyGroup: ByokTableGroup = {
        provider: { ...group.provider, apiKeyKeychainId: undefined },
        models: group.models,
        verification: { ok: false, code: "missing_api_key", checkedAt: 0 },
      };
      renderWithProvider(
        <ByokGlobalTable groups={[noKeyGroup]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      const badge = screen.getByText("No key");
      expect(badge.className).not.toContain("tw-bg-success");
    });

    it("uses a clearer sub-line than '0 models' when a key-set provider has no models", () => {
      const emptyGroup: ByokTableGroup = { ...group, models: [] };
      renderWithProvider(
        <ByokGlobalTable groups={[emptyGroup]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("No models added")).toBeTruthy();
      expect(screen.queryByText("0 models")).toBeNull();
      expect(screen.getByText("Verified")).toBeTruthy();
    });

    it("waits for verification before claiming a keyless provider is running (https://github.com/logancyang/obsidian-copilot/issues/3147)", () => {
      const localGroup: ByokTableGroup = {
        provider: { ...group.provider, displayName: "Ollama", requiresApiKey: false },
        models: [],
      };
      renderWithProvider(
        <ByokGlobalTable groups={[localGroup]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      expect(screen.getByText("Local models on your machine")).toBeTruthy();
      const badge = screen.getByText("Checking…");
      expect(badge.className).not.toContain("tw-bg-success");
    });

    it("collapses and expands when the provider card is clicked", () => {
      renderWithProvider(
        <ByokGlobalTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );

      expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();

      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();

      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
    });

    it("exposes the header as a keyboard-operable button that toggles on Enter/Space", () => {
      renderWithProvider(
        <ByokGlobalTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );

      const header = screen.getByRole("button", { name: /2 models/i });
      expect(header.getAttribute("tabindex")).toBe("0");
      expect(header.getAttribute("aria-expanded")).toBe("false");

      fireEvent.keyDown(header, { key: "Enter" });
      expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
      expect(header.getAttribute("aria-expanded")).toBe("true");

      fireEvent.keyDown(header, { key: " " });
      expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
      expect(header.getAttribute("aria-expanded")).toBe("false");
    });

    it("keeps the per-model remove button mounted (keyboard reachable) when expanded", () => {
      renderWithProvider(
        <ByokGlobalTable groups={[group]} onConfigure={jest.fn()} onRemove={jest.fn()} />
      );
      fireEvent.click(screen.getByText("Anthropic"));

      const removeBtn = screen.getByRole("button", { name: "Remove Claude Sonnet 4.5" });
      expect(removeBtn).toBeTruthy();
      expect(removeBtn.getAttribute("tabindex")).toBe("0");
    });
  });
});
