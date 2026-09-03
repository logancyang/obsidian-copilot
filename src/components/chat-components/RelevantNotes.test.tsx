/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Mock exports must preserve production hook names. */
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { useActiveFile } from "@/hooks/useActiveFile";
import { LIVE_REFRESH_INTERVAL_MS } from "@/hooks/useLiveRelevantNotesRefresh";
import { findRelevantNotes } from "@/search/findRelevantNotes";
import { openCopilotSettings } from "@/settings/openSettings";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Platform, TFile } from "obsidian";
import React from "react";

const mockOpenFile = jest.fn().mockResolvedValue(undefined);
const mockGetLeaf = jest.fn(() => ({ openFile: mockOpenFile }));
let vaultModifyHandlers: ((file: unknown) => void)[] = [];
const mockApp = {
  vault: {
    getAbstractFileByPath: jest.fn(),
    cachedRead: jest.fn().mockResolvedValue(""),
    getName: jest.fn(() => "Work Vault"),
    on: jest.fn((event: string, handler: (file: unknown) => void) => {
      if (event === "modify") vaultModifyHandlers.push(handler);
      return { handler };
    }),
    offref: jest.fn((ref: { handler: (file: unknown) => void }) => {
      vaultModifyHandlers = vaultModifyHandlers.filter((handler) => handler !== ref.handler);
    }),
  },
  workspace: {
    getLeaf: mockGetLeaf,
  },
};
const mockUpdateSetting = jest.fn();
let mockSettings = {
  enableMiyo: true,
  miyoServerUrl: "",
  plusLicenseKey: "old-license",
  relevantNotesLiveUpdate: true,
};
let mockMiyoBackend = "unknown";
let indexChangedListener: (() => void) | null = null;

jest.mock("@/context", () => ({
  useApp: () => mockApp,
}));

jest.mock("@/hooks/useActiveFile", () => ({
  useActiveFile: jest.fn(),
}));

jest.mock("@/hooks/useNoteDrag", () => ({
  useNoteDrag: () => jest.fn(),
}));

jest.mock("@/miyo/useMiyoStatus", () => ({
  useMiyoStatus: () => ({ backend: mockMiyoBackend }),
}));

jest.mock("@/search/findRelevantNotes", () => ({
  ...jest.requireActual<typeof import("@/search/findRelevantNotes")>("@/search/findRelevantNotes"),
  findRelevantNotes: jest.fn(),
}));

jest.mock("@/miyo/miyoIndex", () => ({
  onMiyoIndexChanged: (listener: () => void) => {
    indexChangedListener = listener;
    return () => {
      if (indexChangedListener === listener) indexChangedListener = null;
    };
  },
}));

jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
  updateSetting: (...args: unknown[]) => {
    mockUpdateSetting(...args);
  },
}));

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

const mockUseActiveFile = useActiveFile as jest.MockedFunction<typeof useActiveFile>;
const mockFindRelevantNotes = findRelevantNotes as jest.MockedFunction<typeof findRelevantNotes>;

function makeMarkdownFile(path: string): TFile {
  const MockTFile = TFile as unknown as new (path: string) => TFile;
  return new MockTFile(path);
}

describe("RelevantNotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { isMobile: boolean }).isMobile = false;
    mockSettings = {
      enableMiyo: true,
      miyoServerUrl: "",
      plusLicenseKey: "old-license",
      relevantNotesLiveUpdate: true,
    };
    mockMiyoBackend = "unknown";
    indexChangedListener = null;
    vaultModifyHandlers = [];
    const sourceFile = makeMarkdownFile("Source.md");
    const targetFile = makeMarkdownFile("Target.md");
    mockUseActiveFile.mockReturnValue(sourceFile);
    mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
      path === targetFile.path ? targetFile : sourceFile
    );
    mockFindRelevantNotes.mockResolvedValue({
      notes: [
        {
          note: { path: targetFile.path, title: targetFile.basename },
          metadata: {
            score: 0.8,
            hasOutgoingLinks: false,
            hasBacklinks: false,
          },
        },
      ],
      status: "matches",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (Platform as { isMobile: boolean }).isMobile = false;
  });

  describe("RelevantNotes()", () => {
    it("opens a result in a new leaf", async () => {
      render(<RelevantNotes onAddToChat={jest.fn()} />);

      fireEvent.click(await screen.findByText("Target"));

      expect(mockGetLeaf).toHaveBeenCalledWith(true);
      expect(mockOpenFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Target.md" }));
    });

    it("shows the neutral empty state without searching when no note is active and Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: false };
      mockUseActiveFile.mockReturnValue(null);

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("No relevant notes found")).toBeTruthy();
      expect(screen.queryByText("Add semantic matches with Miyo")).toBeNull();
      expect(screen.queryByText("Target")).toBeNull();
      expect(mockFindRelevantNotes).not.toHaveBeenCalled();
    });

    it("shows the neutral empty state without searching when the active file is not Markdown (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockUseActiveFile.mockReturnValue(makeMarkdownFile("Attachment.pdf"));

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("No relevant notes found")).toBeTruthy();
      expect(screen.queryByText("Miyo is not connected")).toBeNull();
      expect(screen.queryByText("Attachment")).toBeNull();
      expect(mockFindRelevantNotes).not.toHaveBeenCalled();
    });

    it("shows empty setup guidance when Miyo is unavailable and opens the Miyo settings tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes.mockResolvedValue({
        notes: [],
        status: "unavailable",
      });

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Miyo settings" }));
      expect(screen.queryByText("Target")).toBeNull();
      expect(openCopilotSettings).toHaveBeenCalledWith(mockApp, window, "miyo");
    });

    it("shows an informational no-matches state without setup actions when registered Miyo is ready (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes.mockResolvedValue({
        notes: [],
        status: "no-matches",
      });

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("No semantic matches yet")).toBeTruthy();
      expect(screen.queryByText("Target")).toBeNull();
      expect(screen.queryByRole("button", { name: "Open Miyo settings" })).toBeNull();
    });

    it("starts a fresh request when the same note reopens after no note was active (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      const sourceFile = makeMarkdownFile("Source.md");
      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Target")).toBeTruthy();

      mockUseActiveFile.mockReturnValue(null);
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(screen.getByText("No relevant notes found")).toBeTruthy();

      mockFindRelevantNotes.mockReturnValueOnce(new Promise(() => undefined));
      mockUseActiveFile.mockReturnValue(sourceFile);
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("Finding relevant notes…")).toBeTruthy();
      expect(screen.queryByText("Target")).toBeNull();
    });

    it("hides an earlier result when the same note is requested again after another note (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      const sourceFile = makeMarkdownFile("Source.md");
      const otherFile = makeMarkdownFile("Other.md");
      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Target")).toBeTruthy();

      mockFindRelevantNotes.mockReturnValueOnce(new Promise(() => undefined));
      mockUseActiveFile.mockReturnValue(otherFile);
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Finding relevant notes…")).toBeTruthy();

      mockFindRelevantNotes.mockReturnValueOnce(new Promise(() => undefined));
      mockUseActiveFile.mockReturnValue(sourceFile);
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("Finding relevant notes…")).toBeTruthy();
      expect(screen.queryByText("Target")).toBeNull();
      expect(mockFindRelevantNotes).toHaveBeenCalledTimes(3);
    });

    it("refetches when the configured Miyo backend becomes available (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockMiyoBackend = "unavailable";
      mockFindRelevantNotes
        .mockResolvedValueOnce({ notes: [], status: "unavailable" })
        .mockResolvedValueOnce({
          notes: [
            {
              note: { path: "Target.md", title: "Target" },
              metadata: {
                score: 0.9,
                hasOutgoingLinks: false,
                hasBacklinks: false,
              },
            },
          ],
          status: "matches",
        });

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Miyo is not connected")).toBeTruthy();

      mockMiyoBackend = "available";
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("Target")).toBeTruthy();
      expect(mockFindRelevantNotes).toHaveBeenCalledTimes(2);
    });

    it("refetches after Miyo registration or resync signals an index change (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes
        .mockResolvedValueOnce({ notes: [], status: "not-indexed" })
        .mockResolvedValueOnce({
          notes: [
            {
              note: { path: "Target.md", title: "Target" },
              metadata: {
                score: 0.9,
                hasOutgoingLinks: false,
                hasBacklinks: false,
              },
            },
          ],
          status: "matches",
        });

      render(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("This note isn't indexed in Miyo")).toBeTruthy();

      act(() => indexChangedListener?.());

      expect(await screen.findByText("Target")).toBeTruthy();
      expect(mockFindRelevantNotes).toHaveBeenCalledTimes(2);
    });

    it("shows an informational not-indexed state without result rows or a setup claim (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes.mockResolvedValue({
        notes: [],
        status: "not-indexed",
      });

      const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("This note isn't indexed in Miyo")).toBeTruthy();
      expect(
        screen.getByText(
          "It may still be indexing or be excluded from Miyo. Update Miyo to the latest version to see why."
        )
      ).toBeTruthy();
      expect(screen.queryByText("Target")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo" }));
      expect(openSpy).toHaveBeenCalledWith("miyo://open?tab=sources&folder=Work%20Vault", "_blank");
      openSpy.mockRestore();
    });

    it("refetches an unindexed note after the user asks Miyo for its latest state (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes
        .mockResolvedValueOnce({ notes: [], status: "not-indexed" })
        .mockResolvedValueOnce({
          notes: [
            {
              note: { path: "Target.md", title: "Target" },
              metadata: {
                score: 0.9,
                hasOutgoingLinks: false,
                hasBacklinks: false,
              },
            },
          ],
          status: "matches",
        });

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));

      expect(await screen.findByText("Target")).toBeTruthy();
      expect(mockFindRelevantNotes).toHaveBeenCalledTimes(2);
    });

    it.each([
      { runtime: "mobile", isMobile: true, miyoServerUrl: "http://127.0.0.1:8742" },
      { runtime: "remote", isMobile: false, miyoServerUrl: "https://remote-miyo.example" },
    ])(
      "routes the $runtime not-indexed action to Copilot settings instead of a local deeplink (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      async ({ isMobile, miyoServerUrl }) => {
        (Platform as { isMobile: boolean }).isMobile = isMobile;
        mockSettings = { ...mockSettings, miyoServerUrl };
        mockFindRelevantNotes.mockResolvedValue({ notes: [], status: "not-indexed" });
        const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);

        render(<RelevantNotes onAddToChat={jest.fn()} />);

        fireEvent.click(await screen.findByRole("button", { name: "Review Miyo connection" }));
        expect(openCopilotSettings).toHaveBeenCalledWith(mockApp, window, "miyo");
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
      }
    );

    it("shows no readiness or setup guidance while the current Miyo request is loading (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes.mockReturnValue(new Promise(() => undefined));

      const { container } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Finding relevant notes…")).toBeTruthy();

      expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[data-miyo-guidance]")).toBeNull();
      expect(screen.queryByText("No relevant notes found")).toBeNull();
    });

    it("shows the neutral empty state when no Markdown note is active instead of loading forever (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockUseActiveFile.mockReturnValue(null);

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("No relevant notes found")).toBeTruthy();
      expect(mockFindRelevantNotes).not.toHaveBeenCalled();
      expect(screen.queryByText("No semantic matches yet")).toBeNull();
    });

    it("starts fetching Relevant Notes when Miyo is enabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: false };
      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(mockFindRelevantNotes).not.toHaveBeenCalled();

      mockSettings = { ...mockSettings, enableMiyo: true };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);

      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));
    });

    it("keeps a superseded Miyo request from overwriting newer results (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      let resolveFirst:
        | ((notes: Awaited<ReturnType<typeof findRelevantNotes>>) => void)
        | undefined;
      const firstResult = new Promise<Awaited<ReturnType<typeof findRelevantNotes>>>((resolve) => {
        resolveFirst = resolve;
      });
      mockFindRelevantNotes.mockReturnValueOnce(firstResult).mockResolvedValueOnce({
        notes: [
          {
            note: { path: "Current.md", title: "Current" },
            metadata: {
              score: 0.9,
              hasOutgoingLinks: false,
              hasBacklinks: false,
            },
          },
        ],
        status: "matches",
      });

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, miyoServerUrl: "https://new-miyo" };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Current")).toBeTruthy();

      await act(async () => {
        resolveFirst?.({
          notes: [
            {
              note: { path: "Stale.md", title: "Stale" },
              metadata: {
                score: 0.7,
                hasOutgoingLinks: false,
                hasBacklinks: false,
              },
            },
          ],
          status: "matches",
        });
        await firstResult;
      });

      expect(screen.queryByText("Stale")).toBeNull();
      expect(screen.getByText("Current")).toBeTruthy();
    });

    it("supersedes an in-flight request when the Miyo credential changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      let resolveFirst:
        | ((notes: Awaited<ReturnType<typeof findRelevantNotes>>) => void)
        | undefined;
      const firstResult = new Promise<Awaited<ReturnType<typeof findRelevantNotes>>>((resolve) => {
        resolveFirst = resolve;
      });
      mockFindRelevantNotes.mockReturnValueOnce(firstResult).mockResolvedValueOnce({
        notes: [
          {
            note: { path: "Current.md", title: "Current" },
            metadata: {
              score: 0.9,
              hasOutgoingLinks: false,
              hasBacklinks: false,
            },
          },
        ],
        status: "matches",
      });

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, plusLicenseKey: "new-license" };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Current")).toBeTruthy();

      await act(async () => {
        resolveFirst?.({ notes: [], status: "no-matches" });
        await firstResult;
      });

      expect(screen.getByText("Current")).toBeTruthy();
      expect(screen.queryByText("No semantic matches yet")).toBeNull();
    });

    it("keeps a superseded Miyo failure from clearing newer results (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      let rejectFirst: ((reason: Error) => void) | undefined;
      const firstResult = new Promise<Awaited<ReturnType<typeof findRelevantNotes>>>(
        (_, reject) => {
          rejectFirst = reject;
        }
      );
      mockFindRelevantNotes.mockReturnValueOnce(firstResult).mockResolvedValueOnce({
        notes: [
          {
            note: { path: "Current.md", title: "Current" },
            metadata: {
              score: 0.9,
              hasOutgoingLinks: false,
              hasBacklinks: false,
            },
          },
        ],
        status: "matches",
      });

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, miyoServerUrl: "https://new-miyo" };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Current")).toBeTruthy();

      await act(async () => {
        rejectFirst?.(new Error("Old endpoint failed"));
        await expect(firstResult).rejects.toThrow("Old endpoint failed");
      });

      expect(screen.getByText("Current")).toBeTruthy();
    });

    it("keeps the settled rows on screen while a live re-query runs (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", async () => {
      jest.useFakeTimers();
      try {
        render(<RelevantNotes onAddToChat={jest.fn()} />);
        await act(async () => {});
        expect(screen.getByText("Target")).toBeTruthy();
        let releaseLiveQuery: (() => void) | null = null;
        mockFindRelevantNotes.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseLiveQuery = () =>
                resolve({
                  notes: [
                    {
                      note: { path: "Target.md", title: "Target" },
                      metadata: { score: 0.9, hasOutgoingLinks: false, hasBacklinks: false },
                    },
                  ],
                  status: "matches",
                });
            })
        );

        act(() => {
          vaultModifyHandlers.forEach((handler) => handler(makeMarkdownFile("Source.md")));
        });
        act(() => {
          jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
        });

        expect(screen.queryByText("Finding relevant notes…")).toBeNull();
        expect(screen.getByText("Target")).toBeTruthy();
        await act(async () => releaseLiveQuery?.());
      } finally {
        jest.useRealTimers();
      }
    });

    it("re-ranks the rows when a live re-query returns a new order (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", async () => {
      jest.useFakeTimers();
      try {
        render(<RelevantNotes onAddToChat={jest.fn()} />);
        await act(async () => {});
        mockFindRelevantNotes.mockResolvedValue({
          notes: [
            {
              note: { path: "Source Two.md", title: "Source Two" },
              metadata: { score: 0.95, hasOutgoingLinks: false, hasBacklinks: false },
            },
            {
              note: { path: "Target.md", title: "Target" },
              metadata: { score: 0.2, hasOutgoingLinks: false, hasBacklinks: false },
            },
          ],
          status: "matches",
        });

        act(() => {
          vaultModifyHandlers.forEach((handler) => handler(makeMarkdownFile("Source.md")));
        });
        await act(async () => {
          jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
        });

        expect(screen.getByText("Source Two")).toBeTruthy();
        expect(screen.getByText("95%")).toBeTruthy();
      } finally {
        jest.useRealTimers();
      }
    });

    it("never re-queries while live update is switched off (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", async () => {
      jest.useFakeTimers();
      mockSettings = { ...mockSettings, relevantNotesLiveUpdate: false };
      try {
        render(<RelevantNotes onAddToChat={jest.fn()} />);
        await act(async () => {});
        mockFindRelevantNotes.mockClear();

        act(() => {
          vaultModifyHandlers.forEach((handler) => handler(makeMarkdownFile("Source.md")));
          jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 4);
        });

        expect(vaultModifyHandlers).toHaveLength(0);
        expect(mockFindRelevantNotes).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("persists the live update choice so it survives a reload (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", async () => {
      render(<RelevantNotes onAddToChat={jest.fn()} />);
      await act(async () => {});

      fireEvent.click(screen.getByRole("switch"));

      expect(mockUpdateSetting).toHaveBeenCalledWith("relevantNotesLiveUpdate", false);
    });

    it("catches the pane up on writes made while live update was off (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", async () => {
      mockSettings = { ...mockSettings, relevantNotesLiveUpdate: false };
      render(<RelevantNotes onAddToChat={jest.fn()} />);
      await act(async () => {});
      mockFindRelevantNotes.mockClear();

      fireEvent.click(screen.getByRole("switch"));
      await act(async () => {});

      expect(mockUpdateSetting).toHaveBeenCalledWith("relevantNotesLiveUpdate", true);
      expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1);
    });

    it("does not re-query when live update is switched off (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", async () => {
      render(<RelevantNotes onAddToChat={jest.fn()} />);
      await act(async () => {});
      mockFindRelevantNotes.mockClear();

      fireEvent.click(screen.getByRole("switch"));
      await act(async () => {});

      expect(mockFindRelevantNotes).not.toHaveBeenCalled();
    });

    it("offers no live update control while Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: false };

      render(<RelevantNotes onAddToChat={jest.fn()} />);
      await act(async () => {});

      expect(screen.queryByRole("switch")).toBeNull();
    });
  });
});
