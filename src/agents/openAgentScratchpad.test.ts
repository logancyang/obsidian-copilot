import { openAgentScratchpad } from "@/agents/openAgentScratchpad";
import { openVaultPath } from "@/utils/openVaultPath";
import { App, Notice } from "obsidian";

jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));
jest.mock("obsidian", () => ({ Notice: jest.fn() }));

const SCRATCHPAD = "copilot/agents/venkat/Scratchpad.md";

function appWith(paths: readonly string[]): App {
  return {
    vault: { getAbstractFileByPath: (path: string) => (paths.includes(path) ? {} : null) },
  } as unknown as App;
}

describe("openAgentScratchpad", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("openAgentScratchpad()", () => {
    it("opens an existing scratchpad in a new tab", () => {
      const app = appWith([SCRATCHPAD]);

      openAgentScratchpad(app, SCRATCHPAD, "Venkat");

      expect(openVaultPath).toHaveBeenCalledWith(app, SCRATCHPAD, { newLeaf: true });
      expect(Notice).not.toHaveBeenCalled();
    });

    it("hands an existing scratchpad to the caller's opener when one is given", () => {
      const open = jest.fn();

      openAgentScratchpad(appWith([SCRATCHPAD]), SCRATCHPAD, "Venkat", open);

      expect(open).toHaveBeenCalledWith(SCRATCHPAD);
      expect(openVaultPath).not.toHaveBeenCalled();
    });

    it("says the agent has not started one, and opens nothing, when the page does not exist", () => {
      const open = jest.fn();

      openAgentScratchpad(appWith([]), SCRATCHPAD, "Venkat", open);

      expect(Notice).toHaveBeenCalledWith("Venkat hasn't started a scratchpad yet.");
      expect(open).not.toHaveBeenCalled();
    });
  });
});
