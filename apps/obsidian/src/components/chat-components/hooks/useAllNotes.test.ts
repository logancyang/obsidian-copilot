import { act, renderHook } from "@testing-library/react";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { notesAtom } from "@/state/vaultDataAtoms";
import { useAllNotes } from "./useAllNotes";

function vaultFile(path: string, ctime: number): TFile {
  const name = path.split("/").pop()!;
  const extension = name.split(".").pop()!;
  return Object.assign(new TFile(), {
    path,
    name,
    basename: name.slice(0, -(extension.length + 1)),
    extension,
    stat: { ctime, mtime: ctime, size: 0 },
  });
}

describe("useAllNotes", () => {
  beforeEach(() => {
    act(() => settingsStore.set(settingsAtom, DEFAULT_SETTINGS));
  });

  describe("useAllNotes()", () => {
    it("offers PDFs and canvases alongside notes, newest first, in every chat mode https://github.com/logancyang/obsidian-copilot/issues/3538", () => {
      const note = vaultFile("notes/Plan.md", 100);
      const pdf = vaultFile("media/Paper.pdf", 300);
      const canvas = vaultFile("boards/Map.canvas", 200);
      act(() => settingsStore.set(notesAtom, [note, pdf, canvas]));

      const { result } = renderHook(() => useAllNotes());

      expect(result.current.map((file) => file.path)).toEqual([
        "media/Paper.pdf",
        "boards/Map.canvas",
        "notes/Plan.md",
      ]);
    });

    it("leaves the shared vault file list in its original order", () => {
      const older = vaultFile("a.md", 1);
      const newer = vaultFile("b.md", 2);
      act(() => settingsStore.set(notesAtom, [older, newer]));

      renderHook(() => useAllNotes());

      expect(settingsStore.get(notesAtom)).toEqual([older, newer]);
    });

    it("offers notes outside the Copilot folder and project files, not Copilot's own files or project.md https://github.com/Brevilabs/obsidian-copilot-private/issues/961", () => {
      act(() =>
        settingsStore.set(notesAtom, [
          vaultFile("notes/Maya.md", 5),
          vaultFile("copilot/copilot-conversations/Chat.md", 4),
          vaultFile("copilot/copilot-custom-prompts/Fix.md", 3),
          vaultFile("copilot/projects/Trip/project.md", 2),
          vaultFile("copilot/projects/Trip/Itinerary.md", 1),
        ])
      );

      const { result } = renderHook(() => useAllNotes());

      expect(result.current.map((file) => file.path)).toEqual([
        "notes/Maya.md",
        "copilot/projects/Trip/Itinerary.md",
      ]);
    });

    it("re-filters against the new Copilot folder when the setting changes", () => {
      act(() =>
        settingsStore.set(notesAtom, [
          vaultFile("copilot/copilot-conversations/Chat.md", 2),
          vaultFile("team/ai/copilot-conversations/Chat.md", 1),
        ])
      );
      const { result } = renderHook(() => useAllNotes());

      act(() => settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "team/ai" }));

      expect(result.current.map((file) => file.path)).toEqual([
        "copilot/copilot-conversations/Chat.md",
      ]);
    });
  });
});
