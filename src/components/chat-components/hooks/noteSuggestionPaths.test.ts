import { isSuggestedVaultPath } from "./noteSuggestionPaths";

const DEFAULT_ROOT = { copilotFolder: "copilot" };

describe("noteSuggestionPaths", () => {
  describe("isSuggestedVaultPath()", () => {
    it("suggests notes and folders outside the Copilot folder", () => {
      expect(isSuggestedVaultPath("notes/Maya.md", DEFAULT_ROOT)).toBe(true);
      expect(isSuggestedVaultPath("notes", DEFAULT_ROOT)).toBe(true);
      expect(isSuggestedVaultPath("copilot-notes/Plan.md", DEFAULT_ROOT)).toBe(true);
    });

    it("hides Copilot's own files and folders outside the projects folder https://github.com/Brevilabs/obsidian-copilot-private/issues/961", () => {
      expect(isSuggestedVaultPath("copilot", DEFAULT_ROOT)).toBe(false);
      expect(isSuggestedVaultPath("copilot/copilot-conversations/Chat.md", DEFAULT_ROOT)).toBe(
        false
      );
      expect(isSuggestedVaultPath("copilot/copilot-custom-prompts/Fix.md", DEFAULT_ROOT)).toBe(
        false
      );
      expect(isSuggestedVaultPath("copilot/teammates/maya/instructions.md", DEFAULT_ROOT)).toBe(
        false
      );
      expect(isSuggestedVaultPath("copilot/teammates/maya", DEFAULT_ROOT)).toBe(false);
    });

    it("suggests the projects folder and the files and folders the user keeps in a project https://github.com/Brevilabs/obsidian-copilot-private/issues/961", () => {
      expect(isSuggestedVaultPath("copilot/projects", DEFAULT_ROOT)).toBe(true);
      expect(isSuggestedVaultPath("copilot/projects/Trip", DEFAULT_ROOT)).toBe(true);
      expect(isSuggestedVaultPath("copilot/projects/Trip/Itinerary.md", DEFAULT_ROOT)).toBe(true);
      expect(isSuggestedVaultPath("copilot/projects/Trip/sources/Map.pdf", DEFAULT_ROOT)).toBe(
        true
      );
      expect(isSuggestedVaultPath("copilot/projects/Trip/notes/project.md", DEFAULT_ROOT)).toBe(
        true
      );
    });

    it("hides each project's project.md https://github.com/Brevilabs/obsidian-copilot-private/issues/961", () => {
      expect(isSuggestedVaultPath("copilot/projects/Trip/project.md", DEFAULT_ROOT)).toBe(false);
    });

    it("hides the folder of projects that could not be migrated and its backups https://github.com/Brevilabs/obsidian-copilot-private/issues/961", () => {
      expect(isSuggestedVaultPath("copilot/projects/unsupported", DEFAULT_ROOT)).toBe(false);
      expect(
        isSuggestedVaultPath(
          "copilot/projects/unsupported/Project Migration Failed - a1.md",
          DEFAULT_ROOT
        )
      ).toBe(false);
    });

    it("follows a custom Copilot folder instead of the name copilot", () => {
      const customRoot = { copilotFolder: "team/ai" };
      expect(isSuggestedVaultPath("copilot/copilot-conversations/Chat.md", customRoot)).toBe(true);
      expect(isSuggestedVaultPath("team/ai/copilot-conversations/Chat.md", customRoot)).toBe(false);
      expect(isSuggestedVaultPath("team/ai/projects/Trip/Itinerary.md", customRoot)).toBe(true);
      expect(isSuggestedVaultPath("team/ai/projects/Trip/project.md", customRoot)).toBe(false);
      expect(isSuggestedVaultPath("team/notes.md", customRoot)).toBe(true);
    });
  });
});
