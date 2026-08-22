/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Mock exports must preserve production hook names. */
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { useActiveFile } from "@/hooks/useActiveFile";
import { findRelevantNotes } from "@/search/findRelevantNotes";
import { openCopilotSettings } from "@/settings/openSettings";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Platform, TFile } from "obsidian";
import React from "react";

const mockOpenFile = jest.fn().mockResolvedValue(undefined);
const mockGetLeaf = jest.fn(() => ({ openFile: mockOpenFile }));
const mockShouldIndexFile = jest.fn(() => true);
const mockApp = {
  vault: {
    getAbstractFileByPath: jest.fn(),
    cachedRead: jest.fn().mockResolvedValue(""),
  },
  workspace: {
    getLeaf: mockGetLeaf,
  },
};
let mockSettings = {
  enableMiyo: false,
  miyoServerUrl: "",
  qaInclusions: "",
  qaExclusions: "",
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
  findRelevantNotes: jest.fn(),
}));

jest.mock("@/search/indexSignal", () => ({
  onIndexChanged: (listener: () => void) => {
    indexChangedListener = listener;
    return () => {
      if (indexChangedListener === listener) indexChangedListener = null;
    };
  },
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: () => ({ inclusions: [], exclusions: [] }),
  shouldIndexFile: () => mockShouldIndexFile(),
}));

jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
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
    mockShouldIndexFile.mockReturnValue(true);
    mockSettings = {
      enableMiyo: false,
      miyoServerUrl: "",
      qaInclusions: "",
      qaExclusions: "",
    };
    mockMiyoBackend = "unknown";
    indexChangedListener = null;
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
            similarityScore: 0.8,
            hasOutgoingLinks: false,
            hasBacklinks: false,
          },
        },
      ],
      semanticState: "ready",
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

    it("shows Miyo download guidance without graph-only rows when Miyo is disabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockFindRelevantNotes.mockResolvedValue({
        notes: [],
        semanticState: "disabled",
      });

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("Add semantic matches with Miyo")).toBeTruthy();
      expect(screen.queryByText("Target")).toBeNull();
    });

    it("shows empty setup guidance when Miyo is unavailable and opens the Miyo settings tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: true };
      mockFindRelevantNotes.mockResolvedValue({
        notes: [],
        semanticState: "unavailable",
      });

      render(<RelevantNotes onAddToChat={jest.fn()} />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Miyo settings" }));
      expect(screen.queryByText("Target")).toBeNull();
      expect(openCopilotSettings).toHaveBeenCalledWith(mockApp, window, "miyo");
    });

    it("shows an informational no-matches state without setup actions when registered Miyo is ready (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: true };
      mockFindRelevantNotes.mockResolvedValue({
        notes: [
          {
            note: { path: "Target.md", title: "Target" },
            metadata: {
              score: 0,
              similarityScore: undefined,
              hasOutgoingLinks: false,
              hasBacklinks: true,
            },
          },
        ],
        semanticState: "ready",
      });

      render(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Check your Miyo setup")).toBeTruthy();

      act(() => indexChangedListener?.());

      expect(await screen.findByText("No semantic matches yet")).toBeTruthy();
      expect(screen.getByText("Target")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Open Miyo settings" })).toBeNull();
    });

    it("shows an informational not-indexed state beside links without claiming a setup problem (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: true };
      mockFindRelevantNotes.mockResolvedValue({
        notes: [
          {
            note: { path: "Target.md", title: "Target" },
            metadata: {
              score: 0,
              similarityScore: undefined,
              hasOutgoingLinks: true,
              hasBacklinks: false,
            },
          },
        ],
        semanticState: "not-indexed",
      });

      const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
      render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("This note isn't indexed in Miyo")).toBeTruthy();
      expect(
        screen.getByText(
          "It may still be indexing or be excluded from Miyo. Open Miyo to review this folder's indexing and exclusion settings."
        )
      ).toBeTruthy();
      expect(screen.getByText("Target")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open Miyo" }));
      expect(openSpy).toHaveBeenCalledWith("miyo://", "_blank");
      openSpy.mockRestore();
    });

    it.each([
      { runtime: "mobile", isMobile: true, miyoServerUrl: "http://127.0.0.1:8742" },
      { runtime: "remote", isMobile: false, miyoServerUrl: "https://remote-miyo.example" },
    ])(
      "routes the $runtime not-indexed action to Copilot settings instead of a local deeplink (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)",
      async ({ isMobile, miyoServerUrl }) => {
        (Platform as { isMobile: boolean }).isMobile = isMobile;
        mockSettings = { ...mockSettings, enableMiyo: true, miyoServerUrl };
        mockFindRelevantNotes.mockResolvedValue({ notes: [], semanticState: "not-indexed" });
        const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);

        render(<RelevantNotes onAddToChat={jest.fn()} />);

        fireEvent.click(await screen.findByRole("button", { name: "Review Miyo connection" }));
        expect(openMiyoSettings).toHaveBeenCalledWith(mockApp, window);
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
      }
    );

    it("shows no readiness or setup guidance while the current Miyo request is loading (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: true };
      mockFindRelevantNotes.mockReturnValue(new Promise(() => undefined));

      const { container } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      expect(container.querySelector("[data-miyo-guidance]")).toBeNull();
      expect(screen.queryByText("No relevant notes found")).toBeNull();
    });

    it("keeps the excluded-note card and suppresses semantic guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockSettings = { ...mockSettings, enableMiyo: true };
      mockShouldIndexFile.mockReturnValue(false);
      mockFindRelevantNotes.mockResolvedValue({ notes: [], semanticState: "unavailable" });

      const { container } = render(<RelevantNotes onAddToChat={jest.fn()} />);

      expect(await screen.findByText("This note is excluded")).toBeTruthy();
      expect(container.querySelector("[data-miyo-guidance]")).toBeNull();
    });

    it("refetches Relevant Notes when Miyo settings change (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, enableMiyo: true };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);

      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(2));
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
              similarityScore: 0.9,
              hasOutgoingLinks: false,
              hasBacklinks: false,
            },
          },
        ],
        semanticState: "ready",
      });

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, enableMiyo: true, miyoServerUrl: "https://new-miyo" };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Current")).toBeTruthy();

      await act(async () => {
        resolveFirst?.({
          notes: [
            {
              note: { path: "Stale.md", title: "Stale" },
              metadata: {
                score: 0.7,
                similarityScore: 0.7,
                hasOutgoingLinks: false,
                hasBacklinks: false,
              },
            },
          ],
          semanticState: "ready",
        });
        await firstResult;
      });

      expect(screen.queryByText("Stale")).toBeNull();
      expect(screen.getByText("Current")).toBeTruthy();
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
              similarityScore: 0.9,
              hasOutgoingLinks: false,
              hasBacklinks: false,
            },
          },
        ],
        semanticState: "ready",
      });

      const { rerender } = render(<RelevantNotes onAddToChat={jest.fn()} />);
      await waitFor(() => expect(mockFindRelevantNotes).toHaveBeenCalledTimes(1));

      mockSettings = { ...mockSettings, enableMiyo: true, miyoServerUrl: "https://new-miyo" };
      rerender(<RelevantNotes onAddToChat={jest.fn()} />);
      expect(await screen.findByText("Current")).toBeTruthy();

      await act(async () => {
        rejectFirst?.(new Error("Old endpoint failed"));
        await expect(firstResult).rejects.toThrow("Old endpoint failed");
      });

      expect(screen.getByText("Current")).toBeTruthy();
    });
  });
});
