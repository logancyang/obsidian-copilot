import { act, renderHook } from "@testing-library/react";
import { TFolder } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { foldersAtom } from "@/state/vaultDataAtoms";
import { useAllFolders } from "./useAllFolders";

function vaultFolder(path: string): TFolder {
  return Object.assign(new TFolder(), { path, name: path.split("/").pop()! });
}

describe("useAllFolders", () => {
  describe("useAllFolders()", () => {
    it("offers folders outside the Copilot folder and the projects folders, not Copilot's own folders https://github.com/Brevilabs/obsidian-copilot-private/issues/961", () => {
      act(() => {
        settingsStore.set(settingsAtom, DEFAULT_SETTINGS);
        settingsStore.set(
          foldersAtom,
          [
            "notes",
            "copilot",
            "copilot/teammates/maya",
            "copilot/projects",
            "copilot/projects/Trip",
          ].map(vaultFolder)
        );
      });

      const { result } = renderHook(() => useAllFolders());

      expect(result.current.map((folder) => folder.path)).toEqual([
        "notes",
        "copilot/projects",
        "copilot/projects/Trip",
      ]);
    });
  });
});
