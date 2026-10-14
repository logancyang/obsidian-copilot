import {
  getSystemPromptsFolder,
  getPromptFilePath,
  isSystemPromptFile,
  parseSystemPromptFile,
  fetchAllSystemPrompts,
  loadAllSystemPrompts,
} from "@/system-prompts/systemPromptUtils";
import { App, TFile, TAbstractFile } from "obsidian";
import * as settingsModel from "@/settings/model";
import * as state from "@/system-prompts/state";
import type { CopilotSettings } from "@/settings/model";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("obsidian", () => ({
  TFile: jest.fn(),
  TAbstractFile: jest.fn(),
  normalizePath: jest.fn((path: string) => path),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    userSystemPromptsFolder: "SystemPrompts",
  })),
}));

jest.mock("@/settings/copilotFolder", () => {
  const { getSettings } = jest.requireMock<typeof import("@/settings/model")>("@/settings/model");
  return {
    getEffectiveSystemPromptsFolder: jest.fn(() => getSettings().userSystemPromptsFolder),
  };
});

describe("systemPromptUtils", () => {
  describe("getSystemPromptsFolder()", () => {
    it("returns the effective (copilotFolder-derived) system prompts folder", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        userSystemPromptsFolder: "CustomFolder/SystemPrompts",
      } as CopilotSettings);

      const result = getSystemPromptsFolder();
      expect(result).toBe("CustomFolder/SystemPrompts");
    });
  });

  describe("getPromptFilePath()", () => {
    beforeEach(() => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        userSystemPromptsFolder: "SystemPrompts",
      } as CopilotSettings);
    });

    it("returns correct file path with .md extension", () => {
      expect(getPromptFilePath("My Prompt")).toBe("SystemPrompts/My Prompt.md");
    });

    it("handles special characters in title", () => {
      expect(getPromptFilePath("Prompt (copy)")).toBe("SystemPrompts/Prompt (copy).md");
    });
  });

  describe("isSystemPromptFile()", () => {
    beforeEach(() => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        userSystemPromptsFolder: "SystemPrompts",
      } as CopilotSettings);
    });

    it("returns true for valid system prompt file", () => {
      const mockFile = mockTFile({
        path: "SystemPrompts/Test.md",
        extension: "md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      expect(isSystemPromptFile(mockFile)).toBe(true);
    });

    it("returns false for non-TFile objects", () => {
      const mockFile = {
        path: "SystemPrompts/Test.md",
      } as TAbstractFile;

      expect(isSystemPromptFile(mockFile)).toBe(false);
    });

    it("returns false for non-markdown files", () => {
      const mockFile = mockTFile({
        path: "SystemPrompts/Test.txt",
        extension: "txt",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      expect(isSystemPromptFile(mockFile)).toBe(false);
    });

    it("returns false for files outside system prompts folder", () => {
      const mockFile = mockTFile({
        path: "OtherFolder/Test.md",
        extension: "md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      expect(isSystemPromptFile(mockFile)).toBe(false);
    });

    it("returns false for files in subfolders", () => {
      const mockFile = mockTFile({
        path: "SystemPrompts/Subfolder/Test.md",
        extension: "md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      expect(isSystemPromptFile(mockFile)).toBe(false);
    });

    it("returns false for files in unsupported subfolder", () => {
      const mockFile = mockTFile({
        path: "SystemPrompts/unsupported/Failed Migration.md",
        extension: "md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      expect(isSystemPromptFile(mockFile)).toBe(false);
    });

    it("works with custom userSystemPromptsFolder setting", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        userSystemPromptsFolder: "CustomFolder/MyPrompts",
      } as CopilotSettings);

      const validFile = mockTFile({
        path: "CustomFolder/MyPrompts/Test.md",
        extension: "md",
      });

      const unsupportedFile = mockTFile({
        path: "CustomFolder/MyPrompts/unsupported/Failed.md",
        extension: "md",
      });

      Object.setPrototypeOf(validFile, TFile.prototype);
      Object.setPrototypeOf(unsupportedFile, TFile.prototype);

      expect(isSystemPromptFile(validFile)).toBe(true);
      expect(isSystemPromptFile(unsupportedFile)).toBe(false);
    });
  });

  describe("parseSystemPromptFile()", () => {
    let originalApp: typeof window.app;
    let mockFile: TFile;

    beforeEach(() => {
      originalApp = window.app;
      mockFile = mockTFile({
        basename: "Test Prompt",
        path: "SystemPrompts/Test Prompt.md",
        extension: "md",
      });

      window.app = {
        vault: {
          read: jest.fn(),
        },
        metadataCache: {
          getFileCache: jest.fn(),
        },
      } as unknown as typeof window.app;
    });

    afterEach(() => {
      window.app = originalApp;
    });

    it("parses a file with frontmatter and content", async () => {
      const rawContent = `---
copilot-system-prompt-created: 1234567890
copilot-system-prompt-modified: 1234567891
copilot-system-prompt-last-used: 1234567892
---
This is the prompt content.`;

      (app.vault.read as jest.Mock).mockResolvedValue(rawContent);
      (app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          "copilot-system-prompt-created": 1234567890,
          "copilot-system-prompt-modified": 1234567891,
          "copilot-system-prompt-last-used": 1234567892,
        },
      });

      const result = await parseSystemPromptFile(app, mockFile);

      expect(result).toEqual({
        title: "Test Prompt",
        content: "This is the prompt content.",
        createdMs: 1234567890,
        modifiedMs: 1234567891,
        lastUsedMs: 1234567892,
      });
    });

    it("parses a file without frontmatter", async () => {
      const rawContent = "This is the prompt content without frontmatter.";

      (app.vault.read as jest.Mock).mockResolvedValue(rawContent);
      (app.metadataCache.getFileCache as jest.Mock).mockReturnValue({});

      const result = await parseSystemPromptFile(app, mockFile);

      expect(result).toEqual({
        title: "Test Prompt",
        content: "This is the prompt content without frontmatter.",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      });
    });

    it("uses default values for missing frontmatter fields", async () => {
      const rawContent = `---
copilot-system-prompt-created: 1234567890
---
Content here.`;

      (app.vault.read as jest.Mock).mockResolvedValue(rawContent);
      (app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          "copilot-system-prompt-created": 1234567890,
        },
      });

      const result = await parseSystemPromptFile(app, mockFile);

      expect(result).toEqual({
        title: "Test Prompt",
        content: "Content here.",
        createdMs: 1234567890,
        modifiedMs: 0,
        lastUsedMs: 0,
      });
    });

    it("handles content with --- in the middle", async () => {
      const rawContent = `---
copilot-system-prompt-created: 1234567890
---
Content with --- separator in the middle.`;

      (app.vault.read as jest.Mock).mockResolvedValue(rawContent);
      (app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          "copilot-system-prompt-created": 1234567890,
        },
      });

      const result = await parseSystemPromptFile(app, mockFile);

      expect(result.content).toBe("Content with --- separator in the middle.");
    });
  });

  describe("fetchAllSystemPrompts()", () => {
    it("returns parsed prompts from the configured prompt folder", async () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        userSystemPromptsFolder: "SystemPrompts",
      } as CopilotSettings);
      const promptFile = mockTFile({
        basename: "Test Prompt",
        path: "SystemPrompts/Test Prompt.md",
        extension: "md",
      });
      Object.setPrototypeOf(promptFile, TFile.prototype);
      const app = {
        vault: {
          getFiles: jest.fn().mockReturnValue([promptFile]),
          read: jest.fn().mockResolvedValue("Prompt content"),
        },
        metadataCache: {
          getFileCache: jest.fn().mockReturnValue({}),
        },
      } as unknown as App;

      await expect(fetchAllSystemPrompts(app)).resolves.toEqual([
        {
          title: "Test Prompt",
          content: "Prompt content",
          createdMs: 0,
          modifiedMs: 0,
          lastUsedMs: 0,
        },
      ]);
    });
  });

  describe("loadAllSystemPrompts()", () => {
    it("returns the prompts loaded from the vault and stores them in the shared cache", async () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        userSystemPromptsFolder: "SystemPrompts",
      } as CopilotSettings);
      const promptFile = mockTFile({
        basename: "Test Prompt",
        path: "SystemPrompts/Test Prompt.md",
        extension: "md",
      });
      Object.setPrototypeOf(promptFile, TFile.prototype);
      const app = {
        vault: {
          getFiles: jest.fn().mockReturnValue([promptFile]),
          read: jest.fn().mockResolvedValue("Prompt content"),
        },
        metadataCache: {
          getFileCache: jest.fn().mockReturnValue({}),
        },
      } as unknown as App;

      const prompts = await loadAllSystemPrompts(app);

      expect(prompts.map((prompt) => prompt.title)).toEqual(["Test Prompt"]);
      expect(state.getCachedSystemPrompts()).toBe(prompts);
    });
  });
});
