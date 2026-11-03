import { revealSessionsSidebar } from "@/agentMode/navigator/revealSessionsSidebar";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";

jest.mock("obsidian", () => ({ Notice: jest.fn() }));

interface FakeLeaf {
  setViewState: jest.Mock;
}

function makePlugin(options: { existing?: FakeLeaf; leftLeaf?: FakeLeaf | null; ready?: boolean }) {
  const workspace = {
    getLeavesOfType: jest.fn(() => (options.existing ? [options.existing] : [])),
    getLeftLeaf: jest.fn(() => options.leftLeaf ?? null),
    revealLeaf: jest.fn().mockResolvedValue(undefined),
  };
  const plugin = {
    app: { workspace },
    agentSessionManager: options.ready === false ? undefined : {},
  } as unknown as CopilotPlugin;
  return { plugin, workspace };
}

describe("revealSessionsSidebar", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("revealSessionsSidebar()", () => {
    it("opens the Navigator in a new left sidebar leaf and reveals it for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const leaf = { setViewState: jest.fn().mockResolvedValue(undefined) };
      const { plugin, workspace } = makePlugin({ leftLeaf: leaf });

      await revealSessionsSidebar(plugin);

      expect(workspace.getLeftLeaf).toHaveBeenCalledWith(false);
      expect(leaf.setViewState).toHaveBeenCalledWith({
        type: SESSIONS_SIDEBAR_VIEWTYPE,
        active: true,
      });
      expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    });

    it("reveals the open Navigator instead of opening a second one for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const existing = { setViewState: jest.fn() };
      const { plugin, workspace } = makePlugin({ existing });

      await revealSessionsSidebar(plugin);

      expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
      expect(workspace.getLeftLeaf).not.toHaveBeenCalled();
      expect(existing.setViewState).not.toHaveBeenCalled();
    });

    it("does nothing when the workspace has no left sidebar to open in for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const { plugin, workspace } = makePlugin({ leftLeaf: null });

      await expect(revealSessionsSidebar(plugin)).resolves.toBeUndefined();

      expect(workspace.revealLeaf).not.toHaveBeenCalled();
    });

    it("explains that Agent Chat is not ready instead of opening before Agent Mode starts for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const { plugin, workspace } = makePlugin({
        ready: false,
        leftLeaf: { setViewState: jest.fn() },
      });

      await revealSessionsSidebar(plugin);

      expect(Notice).toHaveBeenCalledWith("Agent Chat is not initialized.");
      expect(workspace.getLeftLeaf).not.toHaveBeenCalled();
    });
  });
});
