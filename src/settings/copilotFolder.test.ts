import {
  COPILOT_SUBFOLDER,
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
import { getSettings } from "@/settings/model";
import { DEFAULT_SETTINGS } from "@/constants";

jest.mock("obsidian", () => ({
  // Collapse duplicate separators and trim edges the way Obsidian's helper does,
  // enough for the derived-path assertions here.
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

const mockedGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;

/** Build the minimal settings slice the derivation helpers read. */
function settingsWithRoot(copilotFolder: string): CopilotSettings {
  return { copilotFolder } as CopilotSettings;
}

describe("copilotFolder", () => {
  describe("deriveConversationsFolder()", () => {
    it("derives the historical default conversations path for the default root", () => {
      expect(deriveConversationsFolder(settingsWithRoot("copilot"))).toBe(
        "copilot/copilot-conversations"
      );
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

  describe("deriveCustomPromptsFolder()", () => {
    it("derives the historical default custom-prompts path for the default root", () => {
      expect(deriveCustomPromptsFolder(settingsWithRoot("copilot"))).toBe(
        "copilot/copilot-custom-prompts"
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
    });

    it("re-roots the system-prompts folder under a custom root", () => {
      expect(deriveSystemPromptsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/system-prompts");
    });
  });

  describe("deriveSkillsFolder()", () => {
    it("derives the historical default skills path for the default root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("copilot"))).toBe("copilot/skills");
    });

    it("re-roots the skills folder under a custom root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/skills");
    });
  });

  describe("deriveMemoryFolder()", () => {
    it("derives the historical default memory path for the default root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("copilot"))).toBe("copilot/memory");
    });

    it("re-roots the memory folder under a custom root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("team/ai"))).toBe("team/ai/memory");
    });
  });

  describe("deriveProjectsFolder()", () => {
    it("derives the historical default projects path for the default root", () => {
      expect(deriveProjectsFolder(settingsWithRoot("copilot"))).toBe("copilot/projects");
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

  describe("getEffectiveCopilotFolder()", () => {
    it("returns the configured root read from global settings", () => {
      mockedGetSettings.mockReturnValue(settingsWithRoot("team/ai"));
      expect(getEffectiveCopilotFolder()).toBe("team/ai");
    });
  });

  describe("effective accessors read the live global root", () => {
    it("derive every sub-folder from the current global copilotFolder", () => {
      mockedGetSettings.mockReturnValue(settingsWithRoot("team/ai"));
      expect(getEffectiveConversationsFolder()).toBe("team/ai/copilot-conversations");
      expect(getEffectiveCustomPromptsFolder()).toBe("team/ai/copilot-custom-prompts");
      expect(getEffectiveSystemPromptsFolder()).toBe("team/ai/system-prompts");
      expect(getEffectiveSkillsFolder()).toBe("team/ai/skills");
      expect(getEffectiveMemoryFolder()).toBe("team/ai/memory");
      expect(getEffectiveProjectsFolder()).toBe("team/ai/projects");
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
      // All six are still attempted even though the first threw.
      expect(ensureFolderExists).toHaveBeenCalledTimes(6);
    });
  });

  describe("byte-for-byte parity with the retired default sub-folders", () => {
    // Reason: a default vault (copilotFolder === "copilot") must resolve to the
    // exact paths the retired per-folder defaults used, so upgrades are a no-op.
    const settings = DEFAULT_SETTINGS;

    it("matches the default conversations folder", () => {
      expect(deriveConversationsFolder(settings)).toBe(DEFAULT_SETTINGS.defaultSaveFolder);
    });

    it("matches the default custom-prompts folder", () => {
      expect(deriveCustomPromptsFolder(settings)).toBe(DEFAULT_SETTINGS.customPromptsFolder);
    });

    it("matches the default system-prompts folder", () => {
      expect(deriveSystemPromptsFolder(settings)).toBe(DEFAULT_SETTINGS.userSystemPromptsFolder);
    });

    it("matches the default skills folder", () => {
      expect(deriveSkillsFolder(settings)).toBe(DEFAULT_SETTINGS.agentMode.skills.folder);
    });

    it("matches the default memory folder", () => {
      expect(deriveMemoryFolder(settings)).toBe(DEFAULT_SETTINGS.memoryFolderName);
    });

    it("matches the default projects folder", () => {
      expect(deriveProjectsFolder(settings)).toBe(DEFAULT_SETTINGS.projectsFolder);
    });
  });
});
