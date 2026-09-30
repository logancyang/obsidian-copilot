import {
  COPILOT_SUBFOLDER,
  deriveConversationAttachmentsFolder,
  deriveConversationsFolder,
  deriveCustomPromptsFolder,
  deriveMemoryFolder,
  deriveProjectsFolder,
  deriveSkillsFolder,
  deriveSystemPromptsFolder,
  ensureCopilotSubfolders,
  getEffectiveConversationsFolder,
  getEffectiveCopilotFolder,
  getEffectiveCustomPromptsFolder,
  getEffectiveMemoryFolder,
  getEffectiveProjectsFolder,
  getEffectiveSkillsFolder,
  getEffectiveSystemPromptsFolder,
} from "@/settings/copilotFolder";
import type { CopilotSettings } from "@/settings/model";
import { settingsAtom, settingsStore } from "@/settings/model";
import { DEFAULT_SETTINGS } from "@/constants";

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

function setGlobalRoot(copilotFolder: string): void {
  settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder });
}

function settingsWithRoot(copilotFolder: string): CopilotSettings {
  return { copilotFolder } as CopilotSettings;
}

describe("copilotFolder", () => {
  describe("deriveConversationsFolder()", () => {
    it("derives the historical default conversations path for the default root", () => {
      expect(deriveConversationsFolder(settingsWithRoot("copilot"))).toBe(
        "copilot/copilot-conversations"
      );
      expect(deriveConversationsFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.defaultSaveFolder);
    });

    it("re-roots the conversations folder under a custom root", () => {
      expect(deriveConversationsFolder(settingsWithRoot("team/ai"))).toBe(
        "team/ai/copilot-conversations"
      );
    });

    it("falls back to the default root when the configured root is blank", () => {
      expect(deriveConversationsFolder(settingsWithRoot("  "))).toBe(
        "copilot/copilot-conversations"
      );
    });
  });

  describe("deriveConversationAttachmentsFolder()", () => {
    it("nests the attachment store inside the conversations folder it is given", () => {
      expect(deriveConversationAttachmentsFolder("copilot/copilot-conversations")).toBe(
        "copilot/copilot-conversations/attachments"
      );
    });

    it("follows a relocated Copilot root through the conversations folder", () => {
      expect(deriveConversationAttachmentsFolder("team/ai/copilot-conversations")).toBe(
        "team/ai/copilot-conversations/attachments"
      );
    });
  });

  describe("deriveCustomPromptsFolder()", () => {
    it("derives the historical default custom-prompts path for the default root", () => {
      expect(deriveCustomPromptsFolder(settingsWithRoot("copilot"))).toBe(
        "copilot/copilot-custom-prompts"
      );
      expect(deriveCustomPromptsFolder(DEFAULT_SETTINGS)).toBe(
        DEFAULT_SETTINGS.customPromptsFolder
      );
    });

    it("re-roots the custom-prompts folder under a custom root", () => {
      expect(deriveCustomPromptsFolder(settingsWithRoot("notes/copilot"))).toBe(
        "notes/copilot/copilot-custom-prompts"
      );
    });
  });

  describe("deriveSystemPromptsFolder()", () => {
    it("derives the historical default system-prompts path for the default root", () => {
      expect(deriveSystemPromptsFolder(settingsWithRoot("copilot"))).toBe("copilot/system-prompts");
      expect(deriveSystemPromptsFolder(DEFAULT_SETTINGS)).toBe(
        DEFAULT_SETTINGS.userSystemPromptsFolder
      );
    });

    it("re-roots the system-prompts folder under a custom root", () => {
      expect(deriveSystemPromptsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/system-prompts");
    });
  });

  describe("deriveSkillsFolder()", () => {
    it("derives the historical default skills path for the default root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("copilot"))).toBe("copilot/skills");
      expect(deriveSkillsFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.agentMode.skills.folder);
    });

    it("re-roots the skills folder under a custom root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/skills");
    });
  });

  describe("deriveMemoryFolder()", () => {
    it("derives the historical default memory path for the default root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("copilot"))).toBe("copilot/memory");
      expect(deriveMemoryFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.memoryFolderName);
    });

    it("re-roots the memory folder under a custom root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("team/ai"))).toBe("team/ai/memory");
    });
  });

  describe("deriveProjectsFolder()", () => {
    it("derives the historical default projects path for the default root", () => {
      expect(deriveProjectsFolder(settingsWithRoot("copilot"))).toBe("copilot/projects");
      expect(deriveProjectsFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.projectsFolder);
    });

    it("re-roots the projects folder under a custom root", () => {
      expect(deriveProjectsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/projects");
    });
  });

  describe("COPILOT_SUBFOLDER", () => {
    it("pins the sub-folder names to the historical hardcoded defaults", () => {
      expect(COPILOT_SUBFOLDER).toEqual({
        conversations: "copilot-conversations",
        customPrompts: "copilot-custom-prompts",
        systemPrompts: "system-prompts",
        skills: "skills",
        memory: "memory",
        projects: "projects",
      });
    });
  });

  describe.each([
    ["getEffectiveCopilotFolder", getEffectiveCopilotFolder, "team/ai"],
    [
      "getEffectiveConversationsFolder",
      getEffectiveConversationsFolder,
      "team/ai/copilot-conversations",
    ],
    [
      "getEffectiveCustomPromptsFolder",
      getEffectiveCustomPromptsFolder,
      "team/ai/copilot-custom-prompts",
    ],
    ["getEffectiveSystemPromptsFolder", getEffectiveSystemPromptsFolder, "team/ai/system-prompts"],
    ["getEffectiveSkillsFolder", getEffectiveSkillsFolder, "team/ai/skills"],
    ["getEffectiveMemoryFolder", getEffectiveMemoryFolder, "team/ai/memory"],
    ["getEffectiveProjectsFolder", getEffectiveProjectsFolder, "team/ai/projects"],
  ])("%s()", (_name, getEffective, expected) => {
    it("derives the folder from the current global copilotFolder", () => {
      setGlobalRoot("team/ai");
      expect(getEffective()).toBe(expected);
    });
  });

  describe("ensureCopilotSubfolders()", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ensureFolderExists } = require("@/utils") as {
      ensureFolderExists: jest.MockedFunction<(vault: unknown, folder: string) => Promise<void>>;
    };
    const fakeVault = {} as import("obsidian").Vault;

    beforeEach(() => ensureFolderExists.mockClear());

    it("creates all six derived sub-folders under the given root", async () => {
      await ensureCopilotSubfolders(fakeVault, settingsWithRoot("team/ai"));
      const created = ensureFolderExists.mock.calls.map((call) => call[1]);
      expect(created).toEqual([
        "team/ai/copilot-conversations",
        "team/ai/copilot-custom-prompts",
        "team/ai/system-prompts",
        "team/ai/skills",
        "team/ai/memory",
        "team/ai/projects",
      ]);
    });

    it("continues past a folder that fails so one bad path cannot block the rest", async () => {
      ensureFolderExists
        .mockRejectedValueOnce(new Error("path conflict"))
        .mockResolvedValue(undefined);
      await expect(
        ensureCopilotSubfolders(fakeVault, settingsWithRoot("copilot"))
      ).resolves.toBeUndefined();
      expect(ensureFolderExists).toHaveBeenCalledTimes(6);
    });
  });
});
