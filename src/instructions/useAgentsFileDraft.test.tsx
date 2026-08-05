import { useAgentsFileDraft } from "@/instructions/useAgentsFileDraft";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { App } from "obsidian";

const mockReadAgentsFile = jest.fn<Promise<string>, [App, string]>();

jest.mock("@/instructions/agentsFile", () => ({
  readAgentsFile: (app: App, folderPath: string) => mockReadAgentsFile(app, folderPath),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("useAgentsFileDraft", () => {
  describe("useAgentsFileDraft()", () => {
    const app = {} as App;

    beforeEach(() => {
      mockReadAgentsFile.mockReset();
      mockReadAgentsFile.mockResolvedValue("");
    });

    it("stays null until the file has been read, then reports its text", async () => {
      mockReadAgentsFile.mockResolvedValue("Cite every source.");

      const { result } = renderHook(() => useAgentsFileDraft(app, "Projects/Research"));

      expect(result.current[0]).toBeNull();
      await waitFor(() => expect(result.current[0]).toBe("Cite every source."));
      expect(mockReadAgentsFile).toHaveBeenCalledWith(app, "Projects/Research");
    });

    it("never reads and never resolves for a scope with no folder", async () => {
      const { result } = renderHook(() => useAgentsFileDraft(app, null));

      await waitFor(() => expect(mockReadAgentsFile).not.toHaveBeenCalled());
      expect(result.current[0]).toBeNull();
    });

    it("keeps edits local, leaving the file untouched until the host saves", async () => {
      mockReadAgentsFile.mockResolvedValue("Old rules");
      const { result } = renderHook(() => useAgentsFileDraft(app, ""));
      await waitFor(() => expect(result.current[0]).toBe("Old rules"));

      act(() => result.current[1]("New rules"));

      expect(result.current[0]).toBe("New rules");
    });

    it("re-reads when the folder changes, so a second project shows its own instructions", async () => {
      mockReadAgentsFile.mockResolvedValue("Research rules");
      const { result, rerender } = renderHook(
        ({ folder }: { folder: string }) => useAgentsFileDraft(app, folder),
        { initialProps: { folder: "Projects/Research" } }
      );
      await waitFor(() => expect(result.current[0]).toBe("Research rules"));

      mockReadAgentsFile.mockResolvedValue("Novel rules");
      rerender({ folder: "Projects/Novel" });

      await waitFor(() => expect(result.current[0]).toBe("Novel rules"));
    });

    it("discards a read that lands after the folder moved on", async () => {
      // Without the cancellation guard the slower first read wins and one project's
      // instructions appear under another project's name.
      let resolveFirst: (value: string) => void = () => {};
      mockReadAgentsFile.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        })
      );
      const { result, rerender } = renderHook(
        ({ folder }: { folder: string }) => useAgentsFileDraft(app, folder),
        { initialProps: { folder: "Projects/Research" } }
      );

      mockReadAgentsFile.mockResolvedValue("Novel rules");
      rerender({ folder: "Projects/Novel" });
      await waitFor(() => expect(result.current[0]).toBe("Novel rules"));
      await act(async () => {
        resolveFirst("Research rules");
      });

      expect(result.current[0]).toBe("Novel rules");
    });

    it("leaves the draft unresolved when the file cannot be read", async () => {
      mockReadAgentsFile.mockRejectedValue(new Error("vault is unreadable"));

      const { result } = renderHook(() => useAgentsFileDraft(app, ""));

      await waitFor(() => expect(mockReadAgentsFile).toHaveBeenCalled());
      expect(result.current[0]).toBeNull();
    });
  });
});
