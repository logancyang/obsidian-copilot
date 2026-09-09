import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockEnsureLoaded = jest.fn().mockResolvedValue(undefined);
const mockGetAllProviders = jest.fn().mockReturnValue([]);
const mockOnChange = jest.fn().mockReturnValue(() => {});
const mockRemoveProvider = jest.fn().mockResolvedValue(undefined);
const mockAddProviderOpen = jest.fn();
const mockConfigureOpen = jest.fn();
const mockVerify = jest.fn();
const mockListByOrigin = jest.fn();
const mockUnsubscribe = jest.fn();
let mockProviderListener: (() => void) | undefined;
const mockSubscribe = jest.fn((listener: () => void) => {
  mockProviderListener = listener;
  return mockUnsubscribe;
});

jest.mock("@/modelManagement/ui/ModelManagementContext", () => {
  const api = {
    catalogService: {
      ensureLoaded: mockEnsureLoaded,
      getAllProviders: mockGetAllProviders,
      onChange: mockOnChange,
      refresh: jest.fn(),
    },
    coordinator: { removeProvider: mockRemoveProvider },
    providerRegistry: {
      verify: mockVerify,
      listByOrigin: mockListByOrigin,
      subscribe: mockSubscribe,
    },
  };
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  return { useModelManagement: () => api };
});
// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useApp` hook; the name must match the export
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/modelManagement/state/atoms", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  const byokProviders = jotai.atom([
    {
      providerId: "p1",
      providerType: "anthropic",
      displayName: "Anthropic",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
      addedAt: 0,
    },
    {
      providerId: "p2",
      providerType: "openai-compatible",
      displayName: "Local",
      origin: { kind: "byok" },
      addedAt: 0,
      requiresApiKey: false,
    },
  ]);
  return {
    byokProvidersAtom: byokProviders,
    // The panel renders the visible (Self-Host-filtered) set; with the mode off
    // it's identical to the raw list.
    visibleByokProvidersAtom: byokProviders,
    configuredModelsAtom: jotai.atom([
      {
        configuredModelId: "m1",
        providerId: "p1",
        info: { id: "claude", displayName: "Claude Sonnet 4.5", limits: { context: 200000 } },
        configuredAt: 0,
      },
    ]),
  };
});
jest.mock("@/settings/model", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return {
    settingsStore: jotai.createStore(),
    // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
    useSettingsValue: () => ({ enableSelfHostMode: false }),
  };
});
// Stub the modals — exercised by their own tests. Keeps this test focused
// on the panel's wiring and off the modals' heavy import chains.
jest.mock("@/modelManagement/ui/dialogs/ConfigureProviderDialog", () => ({
  ConfigureProviderModal: jest.fn().mockImplementation(() => ({ open: mockConfigureOpen })),
}));
jest.mock("@/modelManagement/ui/dialogs/AddProviderDialog", () => ({
  AddProviderModal: jest.fn().mockImplementation(() => ({ open: mockAddProviderOpen })),
}));

import { ByokPanel } from "./ByokPanel";

// Radix DropdownMenu portals resolve `activeDocument` at render time.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

describe("ByokPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListByOrigin.mockReturnValue([{ providerId: "p1" }, { providerId: "p2" }]);
    mockVerify.mockReset().mockResolvedValue({ ok: true, checkedAt: 0 });
    mockEnsureLoaded.mockResolvedValue(undefined);
  });
  describe("ByokPanel()", () => {
    it("renders configured providers and their models after the catalog loads", async () => {
      render(<ByokPanel />);
      const providerCard = await screen.findByText("Anthropic");
      expect(providerCard).toBeTruthy();

      // Expand the provider card to see models (default collapsed)
      fireEvent.click(providerCard);
      expect(await screen.findByText("Claude Sonnet 4.5")).toBeTruthy();
    });

    it("opens the Add Provider modal from the add button", async () => {
      render(<ByokPanel />);
      await screen.findByText("Anthropic");
      fireEvent.click(screen.getByRole("button", { name: /Add a provider/i }));
      expect(mockAddProviderOpen).toHaveBeenCalled();
    });
    it("checks each provider independently and clears progress only after every result (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      let resolveFirst!: (result: { ok: boolean; checkedAt: number }) => void;
      let resolveSecond!: (result: { ok: boolean; code: string; checkedAt: number }) => void;
      mockVerify.mockImplementation((id: string) =>
        id === "p1"
          ? new Promise((resolve) => {
              resolveFirst = resolve;
            })
          : new Promise((resolve) => {
              resolveSecond = resolve;
            })
      );
      render(<ByokPanel />);
      await screen.findByText("Anthropic");
      expect(mockListByOrigin).toHaveBeenCalledWith("byok");
      expect(mockVerify.mock.calls).toEqual([["p1"], ["p2"]]);
      expect(screen.getAllByText("Checking…")).toHaveLength(2);
      expect(screen.getByRole("status")).toBeTruthy();
      await act(async () => {
        resolveFirst({ ok: true, checkedAt: 0 });
      });
      expect(screen.getByText("Verified")).toBeTruthy();
      expect(screen.getByText("Checking…")).toBeTruthy();
      expect(screen.getByRole("status")).toBeTruthy();
      await act(async () => {
        resolveSecond({ ok: false, code: "invalid_api_key", checkedAt: 0 });
      });
      expect(screen.getByText("Invalid key")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("rechecks rotated keys and ignores previous requests after a provider mutation (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      const oldResolvers: Array<(result: { ok: boolean; checkedAt: number }) => void> = [];
      mockVerify.mockImplementation(
        () =>
          new Promise((resolve) => {
            oldResolvers.push(resolve);
          })
      );
      render(<ByokPanel />);
      await screen.findByText("Anthropic");
      mockVerify.mockResolvedValue({ ok: false, code: "missing_api_key", checkedAt: 1 });
      await act(async () => {
        mockProviderListener!();
      });
      expect(screen.getAllByText("No key")).toHaveLength(2);
      await act(async () => {
        oldResolvers.forEach((resolve) => resolve({ ok: true, checkedAt: 0 }));
      });
      expect(screen.queryByText("Verified")).toBeNull();
      expect(screen.getAllByText("No key")).toHaveLength(2);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("clears an earlier success while checking edited providers and shows rejected checks (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      render(<ByokPanel />);
      await screen.findAllByText("Verified");
      let rejectCheck!: (error: Error) => void;
      mockListByOrigin.mockReturnValue([{ providerId: "p1" }]);
      mockVerify.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectCheck = reject;
          })
      );
      act(() => {
        mockProviderListener!();
      });
      expect(screen.queryByText("Verified")).toBeNull();
      await act(async () => {
        rejectCheck(new Error("storage unavailable"));
      });
      expect(screen.getByText("Check failed")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("runs fresh checks when the tab remounts and unsubscribes on leave (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      const first = render(<ByokPanel />);
      await screen.findAllByText("Verified");
      first.unmount();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
      mockVerify.mockResolvedValue({ ok: false, code: "invalid_api_key", checkedAt: 1 });
      render(<ByokPanel />);
      await screen.findAllByText("Invalid key");
      expect(mockVerify).toHaveBeenCalledTimes(4);
    });

    it("finishes without a progress banner when there are no providers (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      mockListByOrigin.mockReturnValue([]);
      render(<ByokPanel />);
      await waitFor(() => expect(mockEnsureLoaded).toHaveBeenCalled());
      expect(mockVerify).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).toBeNull();
    });
    it("shows current provider health while the catalog is still loading (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      mockEnsureLoaded.mockReturnValue(new Promise(() => {}));
      render(<ByokPanel />);
      expect(screen.getByText("Anthropic")).toBeTruthy();
      await screen.findAllByText("Verified");
    });

    it("discards in-flight results after leaving and reopening the tab (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      const oldResolvers: Array<(result: { ok: boolean; checkedAt: number }) => void> = [];
      mockVerify.mockImplementation(
        () =>
          new Promise((resolve) => {
            oldResolvers.push(resolve);
          })
      );
      const first = render(<ByokPanel />);
      first.unmount();
      mockVerify.mockResolvedValue({ ok: false, code: "invalid_api_key", checkedAt: 1 });
      render(<ByokPanel />);
      await screen.findAllByText("Invalid key");
      await act(async () => {
        oldResolvers.forEach((resolve) => resolve({ ok: true, checkedAt: 0 }));
      });
      expect(screen.queryByText("Verified")).toBeNull();
      expect(screen.getAllByText("Invalid key")).toHaveLength(2);
    });
  });
});
