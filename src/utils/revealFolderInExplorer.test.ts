import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { Notice, TFolder, type App } from "obsidian";

jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => "/vault" }));

function makeApp(options: {
  resolved: unknown;
  explorerEnabled?: boolean;
  hasReveal?: boolean;
  revealInFolder?: jest.Mock;
  exists?: boolean;
}): App {
  const instance = options.hasReveal ? { revealInFolder: options.revealInFolder } : {};
  return {
    vault: {
      getAbstractFileByPath: () => options.resolved,
      adapter: { exists: async () => options.exists ?? false },
    },
    internalPlugins: {
      getPluginById: (id: string) =>
        id === "file-explorer" ? { enabled: options.explorerEnabled ?? true, instance } : undefined,
    },
  } as unknown as App;
}

describe("revealFolderInExplorer", () => {
  describe("revealFolderInExplorer()", () => {
    beforeEach(() => jest.clearAllMocks());

    it("reveals the folder when it resolves to a TFolder and the explorer is enabled", async () => {
      const revealInFolder = jest.fn();
      const folder = new (TFolder as unknown as new (p: string) => TFolder)("copilot");
      await revealFolderInExplorer(
        makeApp({ resolved: folder, explorerEnabled: true, hasReveal: true, revealInFolder }),
        "copilot"
      );
      expect(revealInFolder).toHaveBeenCalledWith(folder);
      expect(Notice).not.toHaveBeenCalled();
    });

    it("shows a Notice when the folder does not exist", async () => {
      await revealFolderInExplorer(makeApp({ resolved: null }), "copilot");
      expect(Notice).toHaveBeenCalledTimes(1);
    });

    it("opens a hidden folder in the system file manager https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      await revealFolderInExplorer(makeApp({ resolved: null, exists: true }), ".copilot");
      expect(openWithSystemDefault).toHaveBeenCalledWith("/vault/.copilot");
      expect(Notice).not.toHaveBeenCalled();
    });

    it("shows a Notice when the File Explorer plugin is disabled", async () => {
      const folder = new (TFolder as unknown as new (p: string) => TFolder)("copilot");
      await revealFolderInExplorer(
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
