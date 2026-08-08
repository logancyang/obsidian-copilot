import type { CopilotSettings } from "@/settings/model";
import { buildUpgradeRelocationEntries } from "@/settings/upgradeNotice";

jest.mock("obsidian", () => ({
  // Collapse duplicate separators and trim edges the way Obsidian's helper does,
  // enough for the derived-path assertions here.
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
}));

// The pure helpers never read the global store, but copilotFolder.ts imports it.
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

/**
 * Build the settings slice the upgrade notice reads. Defaults every folder to
 * its historical legacy default under the seeded "copilot" root, so a test only
 * overrides the fields it wants to treat as customized.
 */
function buildSettings(
  overrides: Partial<{
    copilotFolder: string;
    defaultSaveFolder: string;
    customPromptsFolder: string;
    userSystemPromptsFolder: string;
    skillsFolder: string;
    memoryFolderName: string;
  }> = {}
): CopilotSettings {
  const {
    copilotFolder = "copilot",
    defaultSaveFolder = "copilot/copilot-conversations",
    customPromptsFolder = "copilot/copilot-custom-prompts",
    userSystemPromptsFolder = "copilot/system-prompts",
    skillsFolder = "copilot/skills",
    memoryFolderName = "copilot/memory",
  } = overrides;
  return {
    copilotFolder,
    defaultSaveFolder,
    customPromptsFolder,
    userSystemPromptsFolder,
    memoryFolderName,
    agentMode: { skills: { folder: skillsFolder } },
  } as unknown as CopilotSettings;
}

describe("upgradeNotice", () => {
  describe("buildUpgradeRelocationEntries()", () => {
    it("returns no entries when every folder is at its legacy default", () => {
      expect(buildUpgradeRelocationEntries(buildSettings())).toEqual([]);
    });

    it("reports a single customized folder with its old value and derived new path", () => {
      const entries = buildUpgradeRelocationEntries(
        buildSettings({ defaultSaveFolder: "my-notes/chats" })
      );
      expect(entries).toEqual([
        {
          label: "Chat conversations",
          oldPath: "my-notes/chats",
          newPath: "copilot/copilot-conversations",
        },
      ]);
    });

    it("reports every customized folder while omitting the untouched ones", () => {
      const entries = buildUpgradeRelocationEntries(
        buildSettings({
          customPromptsFolder: "prompts",
          userSystemPromptsFolder: "sys",
          skillsFolder: "my-skills",
        })
      );
      expect(entries).toEqual([
        { label: "Custom prompts", oldPath: "prompts", newPath: "copilot/copilot-custom-prompts" },
        { label: "System prompts", oldPath: "sys", newPath: "copilot/system-prompts" },
        { label: "Agent skills", oldPath: "my-skills", newPath: "copilot/skills" },
      ]);
    });

    it("lists every sub-folder when the root moves, since they all relocate", () => {
      // Re-rooting to team/ai moves all sub-folders: each old copilot/<name>
      // no longer equals the new team/ai/<name>, so all five are surfaced. The
      // conversations entry additionally reflects the separately-customized old
      // value.
      const entries = buildUpgradeRelocationEntries(
        buildSettings({ copilotFolder: "team/ai", defaultSaveFolder: "old/chats" })
      );
      expect(entries).toEqual([
        {
          label: "Chat conversations",
          oldPath: "old/chats",
          newPath: "team/ai/copilot-conversations",
        },
        {
          label: "Custom prompts",
          oldPath: "copilot/copilot-custom-prompts",
          newPath: "team/ai/copilot-custom-prompts",
        },
        {
          label: "System prompts",
          oldPath: "copilot/system-prompts",
          newPath: "team/ai/system-prompts",
        },
        { label: "Agent skills", oldPath: "copilot/skills", newPath: "team/ai/skills" },
        { label: "Memory", oldPath: "copilot/memory", newPath: "team/ai/memory" },
      ]);
    });

    it("surfaces a customized memory folder, since the new manager reads the derived path", () => {
      // A vault upgraded from a release whose Plus settings exposed "Memory
      // Folder Name" can carry a non-default memoryFolderName; the new manager
      // reads copilot/memory instead, so the old data must be flagged to move.
      const entries = buildUpgradeRelocationEntries(
        buildSettings({ memoryFolderName: "my-memory" })
      );
      expect(entries).toEqual([
        { label: "Memory", oldPath: "my-memory", newPath: "copilot/memory" },
      ]);
    });

    it("omits memory when its stored value is the legacy default", () => {
      expect(
        buildUpgradeRelocationEntries(buildSettings({ memoryFolderName: "copilot/memory" }))
      ).toEqual([]);
    });

    it("omits folders whose old value already equals the derived new path", () => {
      // The user re-rooted to team/ai and their stored sub-folder values already
      // equal the paths that root now derives to — nothing to move, so the
      // notice lists nothing.
      const entries = buildUpgradeRelocationEntries(
        buildSettings({
          copilotFolder: "team/ai",
          defaultSaveFolder: "team/ai/copilot-conversations",
          customPromptsFolder: "team/ai/copilot-custom-prompts",
          userSystemPromptsFolder: "team/ai/system-prompts",
          skillsFolder: "team/ai/skills",
          memoryFolderName: "team/ai/memory",
        })
      );
      expect(entries).toEqual([]);
    });

    it("does not flag a default folder that differs only by a trailing slash", () => {
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ defaultSaveFolder: "copilot/copilot-conversations/" })
        )
      ).toEqual([]);
    });

    it("does not flag a default folder that differs only by a trailing slash then whitespace", () => {
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ defaultSaveFolder: "copilot/copilot-conversations/ " })
        )
      ).toEqual([]);
    });

    it("flags a folder that differs from its default only by letter case as customized", () => {
      // Reason: comparison is case-sensitive to match the QA folder matcher, so on
      // a case-sensitive filesystem `Copilot/...` is a genuinely different directory
      // whose migration notice must still fire.
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ defaultSaveFolder: "Copilot/copilot-conversations" })
        )
      ).toEqual([
        {
          label: "Chat conversations",
          oldPath: "Copilot/copilot-conversations",
          newPath: "copilot/copilot-conversations",
        },
      ]);
    });

    it("does not flag a default folder that differs only by path separator", () => {
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ userSystemPromptsFolder: "copilot\\system-prompts" })
        )
      ).toEqual([]);
    });
  });
});
