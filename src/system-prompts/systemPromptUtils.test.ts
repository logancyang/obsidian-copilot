import {
  validatePromptName,
  getSystemPromptsFolder,
  getPromptFilePath,
  isSystemPromptFile,
  parseSystemPromptFile,
  generateCopyPromptName,
} from "@/system-prompts/systemPromptUtils";
import { UserSystemPrompt } from "@/system-prompts/type";
import { TFile, TAbstractFile, normalizePath } from "obsidian";
import * as settingsModel from "@/settings/model";

// Mock Obsidian
jest.mock("obsidian", () => ({
  TFile: jest.fn(),
  TAbstractFile: jest.fn(),
  normalizePath: jest.fn((path) => path),
}));

// Mock settings
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    userSystemPromptsFolder: "SystemPrompts",
  })),
}));

// Mock state management
jest.mock("@/system-prompts/state", () => ({
  updateCachedSystemPrompts: jest.fn(),
  addPendingFileWrite: jest.fn(),
  removePendingFileWrite: jest.fn(),
}));

describe("validatePromptName", () => {
  const basePrompts: UserSystemPrompt[] = [
    {
      title: "Prompt One",
      content: "",
      createdMs: 0,
      modifiedMs: 0,
      lastUsedMs: 0,
    },
    {
      title: "Prompt Two",
      content: "",
      createdMs: 0,
      modifiedMs: 0,
      lastUsedMs: 0,
    },
    {
      title: "Another Prompt",
      content: "",
      createdMs: 0,
      modifiedMs: 0,
      lastUsedMs: 0,
    },
  ];

  it("returns null for a unique, valid name", () => {
    expect(validatePromptName("New Prompt", basePrompts)).toBeNull();
  });

  it("returns error for duplicate name (case-insensitive)", () => {
    expect(validatePromptName("prompt one", basePrompts)).toBe(
      "A prompt with this name already exists"
    );
    expect(validatePromptName("PROMPT TWO", basePrompts)).toBe(
      "A prompt with this name already exists"
    );
  });

  it("returns error for empty name", () => {
    expect(validatePromptName("", basePrompts)).toBe("Prompt name cannot be empty");
    expect(validatePromptName("   ", basePrompts)).toBe("Prompt name cannot be empty");
  });

  it("returns error for invalid characters", () => {
    const invalids = [
      "Invalid#Name",
      "Invalid<Name>",
      'Invalid:"Name"',
      "Invalid/Name",
      "Invalid\\Name",
      "Invalid|Name",
      "Invalid?Name",
      "Invalid*Name",
      "Invalid[Name]",
      "Invalid^Name",
      "Invalid\x00Name",
      "Invalid\x1FName",
    ];
    for (const name of invalids) {
      expect(validatePromptName(name, basePrompts)).toMatch(
        /Prompt name contains invalid characters/
      );
    }
  });

  it("returns null if unchanged currentPromptName", () => {
    expect(validatePromptName("Prompt One", basePrompts, "Prompt One")).toBeNull();
  });

  it("allows renaming with trimmed whitespace", () => {
    expect(validatePromptName("  Prompt One  ", basePrompts, "Prompt One")).toBeNull();
  });
});

describe("getSystemPromptsFolder", () => {
  it("returns the system prompts folder path from settings", () => {
    jest.spyOn(settingsModel, "getSettings").mockReturnValue({
      userSystemPromptsFolder: "CustomFolder/SystemPrompts",
    } as any);

    const result = getSystemPromptsFolder();
    expect(result).toBe("CustomFolder/SystemPrompts");
  });

  it("normalizes the path", () => {
    jest.spyOn(settingsModel, "getSettings").mockReturnValue({
      userSystemPromptsFolder: "SystemPrompts",
    } as any);

    const result = getSystemPromptsFolder();
    expect(normalizePath).toHaveBeenCalled();
    expect(result).toBe("SystemPrompts");
  });
});

describe("getPromptFilePath", () => {
  beforeEach(() => {
    jest.spyOn(settingsModel, "getSettings").mockReturnValue({
      userSystemPromptsFolder: "SystemPrompts",
    } as any);
  });

  it("returns correct file path with .md extension", () => {
    expect(getPromptFilePath("My Prompt")).toBe("SystemPrompts/My Prompt.md");
  });

  it("handles special characters in title", () => {
    expect(getPromptFilePath("Prompt (copy)")).toBe("SystemPrompts/Prompt (copy).md");
  });
});

describe("isSystemPromptFile", () => {
  beforeEach(() => {
    jest.spyOn(settingsModel, "getSettings").mockReturnValue({
      userSystemPromptsFolder: "SystemPrompts",
    } as any);
  });

  it("returns true for valid system prompt file", () => {
    const mockFile = {
      path: "SystemPrompts/Test.md",
      extension: "md",
    } as TFile;

    // Mock instanceof check
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
    const mockFile = {
      path: "SystemPrompts/Test.txt",
      extension: "txt",
    } as TFile;

    Object.setPrototypeOf(mockFile, TFile.prototype);

    expect(isSystemPromptFile(mockFile)).toBe(false);
  });

  it("returns false for files outside system prompts folder", () => {
    const mockFile = {
      path: "OtherFolder/Test.md",
      extension: "md",
    } as TFile;

    Object.setPrototypeOf(mockFile, TFile.prototype);

    expect(isSystemPromptFile(mockFile)).toBe(false);
  });

  it("returns false for files in subfolders", () => {
    const mockFile = {
      path: "SystemPrompts/Subfolder/Test.md",
      extension: "md",
    } as TFile;

    Object.setPrototypeOf(mockFile, TFile.prototype);

    expect(isSystemPromptFile(mockFile)).toBe(false);
  });
});

describe("parseSystemPromptFile", () => {
  let originalApp: any;
  let mockFile: TFile;

  beforeEach(() => {
    originalApp = global.app;
    mockFile = {
      basename: "Test Prompt",
      path: "SystemPrompts/Test Prompt.md",
      extension: "md",
    } as TFile;

    global.app = {
      vault: {
        read: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as any;
  });

  afterEach(() => {
    global.app = originalApp;
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

    const result = await parseSystemPromptFile(mockFile);

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

    const result = await parseSystemPromptFile(mockFile);

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

    const result = await parseSystemPromptFile(mockFile);

    expect(result).toEqual({
      title: "Test Prompt",
      content: "Content here.",
      createdMs: 1234567890,
      modifiedMs: 0,
      lastUsedMs: 0,
    });
  });

  it("strips frontmatter from content", async () => {
    const rawContent = `---
copilot-system-prompt-created: 1234567890
---
Line 1
Line 2`;

    (app.vault.read as jest.Mock).mockResolvedValue(rawContent);
    (app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
      frontmatter: {
        "copilot-system-prompt-created": 1234567890,
      },
    });

    const result = await parseSystemPromptFile(mockFile);

    expect(result.content).toBe("Line 1\nLine 2");
    expect(result.content).not.toContain("---");
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

    const result = await parseSystemPromptFile(mockFile);

    expect(result.content).toBe("Content with --- separator in the middle.");
  });
});

describe("generateCopyPromptName", () => {
  it("generates (copy) suffix for first copy", () => {
    const prompts: UserSystemPrompt[] = [
      {
        title: "Original",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
    ];

    expect(generateCopyPromptName("Original", prompts)).toBe("Original (copy)");
  });

  it("generates (copy 2) suffix when (copy) exists", () => {
    const prompts: UserSystemPrompt[] = [
      {
        title: "Original",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
      {
        title: "Original (copy)",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
    ];

    expect(generateCopyPromptName("Original", prompts)).toBe("Original (copy 2)");
  });

  it("generates incrementing copy numbers", () => {
    const prompts: UserSystemPrompt[] = [
      {
        title: "Original",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
      {
        title: "Original (copy)",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
      {
        title: "Original (copy 2)",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
      {
        title: "Original (copy 3)",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
    ];

    expect(generateCopyPromptName("Original", prompts)).toBe("Original (copy 4)");
  });

  it("handles case-insensitive duplicate checking", () => {
    const prompts: UserSystemPrompt[] = [
      {
        title: "Original",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
      {
        title: "ORIGINAL (COPY)",
        content: "",
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
      },
    ];

    expect(generateCopyPromptName("Original", prompts)).toBe("Original (copy 2)");
  });

  it("works with empty prompts array", () => {
    expect(generateCopyPromptName("Original", [])).toBe("Original (copy)");
  });
});
