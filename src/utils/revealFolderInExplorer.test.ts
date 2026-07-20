import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { Notice, TFolder, type App } from "obsidian";

/** Build an App whose vault resolves `relPath` to `resolved` and exposes an
 *  optionally-enabled File Explorer with a spyable `revealInFolder`. */
function makeApp(options: {
  resolved: unknown;
  explorerEnabled?: boolean;
  hasReveal?: boolean;
  revealInFolder?: jest.Mock;
}): App {
  const instance = options.hasReveal ? { revealInFolder: options.revealInFolder } : {};
  return {
    vault: { getAbstractFileByPath: () => options.resolved },
    internalPlugins: {
      getPluginById: (id: string) =>
        id === "file-explorer" ? { enabled: options.explorerEnabled ?? true, instance } : undefined,
    },
  } as unknown as App;
}

describe("revealFolderInExplorer", () => {
  describe("revealFolderInExplorer()", () => {
    beforeEach(() => jest.clearAllMocks());

    it("reveals the folder when it resolves to a TFolder and the explorer is enabled", () => {
      const revealInFolder = jest.fn();
      const folder = new (TFolder as unknown as new (p: string) => TFolder)("copilot");
      revealFolderInExplorer(
        makeApp({ resolved: folder, explorerEnabled: true, hasReveal: true, revealInFolder }),
        "copilot"
      );
      expect(revealInFolder).toHaveBeenCalledWith(folder);
      expect(Notice).not.toHaveBeenCalled();
    });

    it("shows a Notice when the folder is not in the vault cache", () => {
      revealFolderInExplorer(makeApp({ resolved: null }), "copilot");
      expect(Notice).toHaveBeenCalledTimes(1);
    });

    it("shows a Notice when the File Explorer plugin is disabled", () => {
      const folder = new (TFolder as unknown as new (p: string) => TFolder)("copilot");
      revealFolderInExplorer(
        makeApp({
          resolved: folder,
          explorerEnabled: false,
          hasReveal: true,
          revealInFolder: jest.fn(),
        }),
        "copilot"
      );
      expect(Notice).toHaveBeenCalledTimes(1);
    });
  });
});
