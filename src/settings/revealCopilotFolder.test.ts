import { revealHiddenCopilotFolder } from "@/settings/revealCopilotFolder";
import { MemoryFolderAdapter } from "@/settings/testing/memoryFolderAdapter";

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

function vaultWith(adapter: MemoryFolderAdapter) {
  return { adapter, configDir: ".vault-config" };
}

describe("revealCopilotFolder", () => {
  describe("revealHiddenCopilotFolder()", () => {
    it("moves every Copilot folder from the hidden root into a visible root that does not exist yet", async () => {
      const adapter = new MemoryFolderAdapter({
        ".copilot/copilot-conversations/chat.md": "",
        ".copilot/projects/alpha/project.md": "",
      });

      const item = await revealHiddenCopilotFolder(vaultWith(adapter), ".copilot", "copilot");

      expect(adapter.files.sort()).toEqual([
        "copilot/copilot-conversations/chat.md",
        "copilot/projects/alpha/project.md",
      ]);
      expect(item).toEqual({
        id: "copilot-folder",
        title: "Copilot folder",
        status: "success",
        summary: "Moved .copilot to copilot. Copilot folders can no longer be hidden.",
      });
    });

    it("creates the visible parent folders of a nested root before moving it", async () => {
      const adapter = new MemoryFolderAdapter({ ".work/.ai/memory/Saved Memories.md": "" });

      await revealHiddenCopilotFolder(vaultWith(adapter), ".work/.ai/", "work/ai");

      expect(adapter.files).toEqual(["work/ai/memory/Saved Memories.md"]);
    });

    it("merges into an existing visible root and leaves files whose names are taken in the hidden root (https://github.com/Brevilabs/obsidian-copilot-private/issues/712)", async () => {
      const adapter = new MemoryFolderAdapter({
        ".copilot/copilot-conversations/new-chat.md": "",
        ".copilot/memory/Saved Memories.md": "",
        ".copilot/skills/writer/SKILL.md": "",
        "copilot/memory/Saved Memories.md": "",
      });
      adapter.addFolder("copilot/copilot-conversations");

      const item = await revealHiddenCopilotFolder(vaultWith(adapter), ".copilot", "copilot");

      expect(adapter.files.sort()).toEqual([
        ".copilot/memory/Saved Memories.md",
        "copilot/copilot-conversations/new-chat.md",
        "copilot/memory/Saved Memories.md",
        "copilot/skills/writer/SKILL.md",
      ]);
      expect(item).toMatchObject({
        status: "action-required",
        details: ["Left in place: .copilot/memory/Saved Memories.md."],
      });
    });

    it("keeps Copilot's caches in .copilot and reports nothing when no Copilot folder is inside it (https://github.com/Brevilabs/obsidian-copilot-private/issues/712)", async () => {
      const adapter = new MemoryFolderAdapter({
        ".copilot/model-catalog-cache.json": "",
        ".copilot/file-content-cache/abc.json": "",
      });

      expect(await revealHiddenCopilotFolder(vaultWith(adapter), ".copilot", "copilot")).toBeNull();
      expect(adapter.files.sort()).toEqual([
        ".copilot/file-content-cache/abc.json",
        ".copilot/model-catalog-cache.json",
      ]);

      const withMemory = new MemoryFolderAdapter({
        ".copilot/model-catalog-cache.json": "",
        ".copilot/memory/Saved Memories.md": "",
      });
      const item = await revealHiddenCopilotFolder(vaultWith(withMemory), ".copilot", "copilot");

      expect(item).toMatchObject({ status: "success" });
      expect(withMemory.files.sort()).toEqual([
        ".copilot/model-catalog-cache.json",
        "copilot/memory/Saved Memories.md",
      ]);
    });

    it("does nothing for a visible root, a missing hidden folder, or a non-string setting", async () => {
      const adapter = new MemoryFolderAdapter({ "copilot/memory/Saved Memories.md": "" });

      expect(await revealHiddenCopilotFolder(vaultWith(adapter), "copilot", "copilot")).toBeNull();
      expect(await revealHiddenCopilotFolder(vaultWith(adapter), ".copilot", "copilot")).toBeNull();
      expect(await revealHiddenCopilotFolder(vaultWith(adapter), undefined, "copilot")).toBeNull();
      expect(adapter.files).toEqual(["copilot/memory/Saved Memories.md"]);
    });

    it("never moves files out of or around the Obsidian config folder", async () => {
      const adapter = new MemoryFolderAdapter({
        ".vault-config/plugins/copilot-data/memory/Saved Memories.md": "",
      });

      const item = await revealHiddenCopilotFolder(
        vaultWith(adapter),
        ".vault-config/plugins/copilot-data",
        "vault-config/plugins/copilot-data"
      );

      expect(item).toBeNull();
      expect(adapter.files).toEqual([
        ".vault-config/plugins/copilot-data/memory/Saved Memories.md",
      ]);
    });

    it("reports an error item and keeps the hidden files when the move fails", async () => {
      const adapter = new MemoryFolderAdapter({ ".copilot/memory/Saved Memories.md": "" });
      adapter.rename = jest.fn().mockRejectedValue(new Error("EACCES"));

      const item = await revealHiddenCopilotFolder(vaultWith(adapter), ".copilot", "copilot");

      expect(item).toMatchObject({ id: "copilot-folder", status: "error" });
      expect(adapter.files).toEqual([".copilot/memory/Saved Memories.md"]);
    });
  });
});
