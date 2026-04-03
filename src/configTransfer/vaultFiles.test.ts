/**
 * Tests for vault file collection and restoration logic.
 */

jest.mock("obsidian", () => ({
  normalizePath: (p: string) => p.replace(/\\/g, "/"),
  TFile: class TFile {},
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const mockGetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

const mockEnsureFolderExists = jest.fn().mockResolvedValue(undefined);
const mockListDirectChildMdFiles = jest.fn().mockReturnValue([]);
jest.mock("@/utils", () => ({
  ensureFolderExists: (...args: unknown[]) => mockEnsureFolderExists(...args),
  listDirectChildMdFiles: (...args: unknown[]) => mockListDirectChildMdFiles(...args),
}));

import { TFile } from "obsidian";
import { collectAllVaultFiles, restoreVaultFiles, rollbackVaultFiles } from "./vaultFiles";
import type { CollectedVaultFiles, ExportContentOptions } from "./vaultFiles";
import type { CopilotSettings } from "@/settings/model";

/** Create a mock TFile with the given path. */
function createMockTFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split("/").pop() ?? "",
    extension: (path.split("/").pop() ?? "").split(".").pop() ?? "",
    stat: { size: 0, ctime: 0, mtime: 0 },
  });
  return file;
}

describe("collectAllVaultFiles", () => {
  const mockRead = jest.fn();
  const mockGetAbstractFileByPath = jest.fn();

  const mockApp = {
    vault: {
      read: mockRead,
      getAbstractFileByPath: mockGetAbstractFileByPath,
    },
  } as unknown as import("obsidian").App;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue({
      customPromptsFolder: "copilot/custom-prompts",
      userSystemPromptsFolder: "copilot/system-prompts",
      memoryFolderName: "copilot/memory",
    });
  });

  it("collects commands, prompts, and memory files", async () => {
    const cmdFile = createMockTFile("copilot/custom-prompts/Summarize.md");
    const promptFile = createMockTFile("copilot/system-prompts/Code Review.md");
    const recentFile = createMockTFile("copilot/memory/Recent Conversations.md");
    const savedFile = createMockTFile("copilot/memory/Saved Memories.md");

    // listDirectChildMdFiles is called for commands and prompts folders
    mockListDirectChildMdFiles.mockImplementation((folder: string) => {
      if (folder === "copilot/custom-prompts") return [cmdFile];
      if (folder === "copilot/system-prompts") return [promptFile];
      return [];
    });

    mockGetAbstractFileByPath.mockImplementation((path: string) => {
      if (path === "copilot/memory/Recent Conversations.md") return recentFile;
      if (path === "copilot/memory/Saved Memories.md") return savedFile;
      return null;
    });

    mockRead.mockImplementation((file: TFile) => {
      if (file.path.includes("Summarize")) return "---\ncmd\n---\nbody";
      if (file.path.includes("Code Review")) return "---\nprompt\n---\nbody";
      if (file.path.includes("Recent")) return "## Chat 1";
      if (file.path.includes("Saved")) return "- memory 1";
      return "";
    });

    // Reason: pass all-true options to test full collection.
    const allOptions = {
      customCommands: true,
      systemPrompts: true,
      memory: true,
    };
    const result = await collectAllVaultFiles(mockApp, allOptions);

    expect(result.customCommands).toHaveLength(1);
    expect(result.customCommands[0].filename).toBe("Summarize.md");
    expect(result.systemPrompts).toHaveLength(1);
    expect(result.systemPrompts[0].filename).toBe("Code Review.md");
    expect(result.memory.recentConversations).toBe("## Chat 1");
    expect(result.memory.savedMemories).toBe("- memory 1");
  });

  it("returns empty arrays when folders don't exist", async () => {
    mockListDirectChildMdFiles.mockReturnValue([]);
    mockGetAbstractFileByPath.mockReturnValue(null);

    const result = await collectAllVaultFiles(mockApp);

    expect(result.customCommands).toHaveLength(0);
    expect(result.systemPrompts).toHaveLength(0);
    expect(result.memory.recentConversations).toBeNull();
    expect(result.memory.savedMemories).toBeNull();
  });

  it("only collects direct children via listDirectChildMdFiles", async () => {
    const directFile = createMockTFile("copilot/custom-prompts/Summarize.md");

    // listDirectChildMdFiles already filters to direct children only
    mockListDirectChildMdFiles.mockImplementation((folder: string) => {
      if (folder === "copilot/custom-prompts") return [directFile];
      return [];
    });
    mockGetAbstractFileByPath.mockReturnValue(null);
    mockRead.mockResolvedValue("content");

    const result = await collectAllVaultFiles(mockApp);

    expect(result.customCommands).toHaveLength(1);
    expect(result.customCommands[0].filename).toBe("Summarize.md");
  });
});

describe("restoreVaultFiles", () => {
  const mockCreate = jest.fn().mockResolvedValue(undefined);
  const mockModify = jest.fn().mockResolvedValue(undefined);
  const mockRead = jest.fn().mockResolvedValue("old content");
  const mockGetAbstractFileByPath = jest.fn();

  const mockApp = {
    vault: {
      create: mockCreate,
      modify: mockModify,
      read: mockRead,
      getAbstractFileByPath: mockGetAbstractFileByPath,
    },
  } as unknown as import("obsidian").App;

  const mockSettings = {
    customPromptsFolder: "copilot/custom-prompts",
    userSystemPromptsFolder: "copilot/system-prompts",
    memoryFolderName: "copilot/memory",
  } as unknown as CopilotSettings;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates new files when they don't exist", async () => {
    mockGetAbstractFileByPath.mockReturnValue(null);

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Summarize.md", content: "---\ncmd\n---\nbody" }],
      systemPrompts: [{ filename: "Code Review.md", content: "---\nprompt\n---\nbody" }],
      memory: { recentConversations: "## Chat", savedMemories: "- mem" },
    };

    const result = await restoreVaultFiles(mockApp, files, mockSettings);

    expect(result.commandsWritten).toBe(1);
    expect(result.promptsWritten).toBe(1);
    expect(result.memoryWritten).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledTimes(4);
  });

  it("modifies existing files (overwrite)", async () => {
    const existingFile = createMockTFile("copilot/custom-prompts/Summarize.md");
    mockGetAbstractFileByPath.mockImplementation((path: string) => {
      if (path === "copilot/custom-prompts/Summarize.md") return existingFile;
      return null;
    });

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Summarize.md", content: "new content" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, mockSettings);

    expect(result.commandsWritten).toBe(1);
    expect(mockModify).toHaveBeenCalledWith(existingFile, "new content");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("allows filenames containing consecutive dots (not path traversal)", async () => {
    mockGetAbstractFileByPath.mockReturnValue(null);

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Prompt..v2.md", content: "ok" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, mockSettings);

    expect(result.commandsWritten).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledWith("copilot/custom-prompts/Prompt..v2.md", "ok");
  });

  it("rejects filenames with path separators", async () => {
    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "sub/evil.md", content: "hack" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, mockSettings);

    expect(result.commandsWritten).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("path separators");
  });

  it("rejects non-.md filenames", async () => {
    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "evil.js", content: "hack" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, mockSettings);

    expect(result.commandsWritten).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("not a .md file");
  });

  it("skips null memory files", async () => {
    mockGetAbstractFileByPath.mockReturnValue(null);

    const files: CollectedVaultFiles = {
      customCommands: [],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, mockSettings);

    expect(result.memoryWritten).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reports error when folder creation fails", async () => {
    mockEnsureFolderExists.mockRejectedValueOnce(new Error("Permission denied"));

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Test.md", content: "test" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, mockSettings);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to create folders");
    expect(result.commandsWritten).toBe(0);
  });

  it("rejects absolute folder paths from imported settings", async () => {
    const unsafeSettings = {
      ...mockSettings,
      customPromptsFolder: "/etc/evil",
    } as unknown as CopilotSettings;

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Test.md", content: "test" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, unsafeSettings);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("absolute path");
    expect(result.commandsWritten).toBe(0);
  });

  it("rejects folder paths with path traversal", async () => {
    const unsafeSettings = {
      ...mockSettings,
      customPromptsFolder: "copilot/../../../secret",
    } as unknown as CopilotSettings;

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Test.md", content: "test" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, unsafeSettings);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("path traversal");
    expect(result.commandsWritten).toBe(0);
  });

  it("rejects empty folder paths", async () => {
    const unsafeSettings = {
      ...mockSettings,
      customPromptsFolder: "",
    } as unknown as CopilotSettings;

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Test.md", content: "test" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    const result = await restoreVaultFiles(mockApp, files, unsafeSettings);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("empty");
    expect(result.commandsWritten).toBe(0);
  });

  it("allows folder paths outside the copilot/ namespace", async () => {
    const customSettings = {
      ...mockSettings,
      customPromptsFolder: "my-custom-prompts",
    } as unknown as CopilotSettings;

    const files: CollectedVaultFiles = {
      customCommands: [{ filename: "Test.md", content: "test" }],
      systemPrompts: [],
      memory: { recentConversations: null, savedMemories: null },
    };

    // Reason: users may configure folders anywhere in the vault.
    const result = await restoreVaultFiles(mockApp, files, customSettings);

    expect(result.errors).toHaveLength(0);
    expect(result.commandsWritten).toBe(1);
  });
});

describe("collectAllVaultFiles with export options", () => {
  const mockRead = jest.fn();
  const mockGetAbstractFileByPath = jest.fn();

  const mockApp = {
    vault: {
      read: mockRead,
      getAbstractFileByPath: mockGetAbstractFileByPath,
    },
  } as unknown as import("obsidian").App;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue({
      customPromptsFolder: "copilot/custom-prompts",
      userSystemPromptsFolder: "copilot/system-prompts",
      memoryFolderName: "copilot/memory",
    });

    const cmdFile = createMockTFile("copilot/custom-prompts/Summarize.md");
    const promptFile = createMockTFile("copilot/system-prompts/Code Review.md");
    const recentFile = createMockTFile("copilot/memory/Recent Conversations.md");
    const savedFile = createMockTFile("copilot/memory/Saved Memories.md");

    mockListDirectChildMdFiles.mockImplementation((folder: string) => {
      if (folder === "copilot/custom-prompts") return [cmdFile];
      if (folder === "copilot/system-prompts") return [promptFile];
      return [];
    });

    mockGetAbstractFileByPath.mockImplementation((path: string) => {
      if (path === "copilot/memory/Recent Conversations.md") return recentFile;
      if (path === "copilot/memory/Saved Memories.md") return savedFile;
      return null;
    });

    mockRead.mockImplementation((file: TFile) => {
      if (file.path.includes("Summarize")) return "cmd content";
      if (file.path.includes("Code Review")) return "prompt content";
      if (file.path.includes("Recent")) return "## Chat 1";
      if (file.path.includes("Saved")) return "- memory 1";
      return "";
    });
  });

  it("excludes memory files by default (privacy)", async () => {
    const result = await collectAllVaultFiles(mockApp);

    expect(result.customCommands).toHaveLength(1);
    expect(result.systemPrompts).toHaveLength(1);
    expect(result.memory.savedMemories).toBeNull();
    expect(result.memory.recentConversations).toBeNull();
  });

  it("excludes unchecked sections", async () => {
    const options: ExportContentOptions = {
      customCommands: false,
      systemPrompts: false,
      memory: false,
    };
    const result = await collectAllVaultFiles(mockApp, options);

    expect(result.customCommands).toHaveLength(0);
    expect(result.systemPrompts).toHaveLength(0);
    expect(result.memory.recentConversations).toBeNull();
    expect(result.memory.savedMemories).toBeNull();
  });
});

describe("rollbackVaultFiles", () => {
  const mockCreate = jest.fn().mockResolvedValue(undefined);
  const mockModify = jest.fn().mockResolvedValue(undefined);
  const mockDelete = jest.fn().mockResolvedValue(undefined);
  const mockGetAbstractFileByPath = jest.fn();

  const mockApp = {
    vault: {
      create: mockCreate,
      modify: mockModify,
      delete: mockDelete,
      getAbstractFileByPath: mockGetAbstractFileByPath,
    },
  } as unknown as import("obsidian").App;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("restores overwritten files and deletes new files", async () => {
    const existingFile = createMockTFile("copilot/custom-prompts/Summarize.md");
    mockGetAbstractFileByPath.mockReturnValue(existingFile);

    const rollback = [
      { path: "copilot/custom-prompts/Summarize.md", previousContent: "original" },
      { path: "copilot/custom-prompts/New.md", previousContent: null },
    ];

    const failed = await rollbackVaultFiles(mockApp, rollback);

    expect(failed).toHaveLength(0);
    expect(mockModify).toHaveBeenCalledWith(existingFile, "original");
    expect(mockDelete).toHaveBeenCalledWith(existingFile);
  });

  it("recreates overwritten files that were deleted before rollback", async () => {
    mockGetAbstractFileByPath.mockReturnValue(null);

    const rollback = [
      { path: "copilot/custom-prompts/Gone.md", previousContent: "original content" },
    ];

    const failed = await rollbackVaultFiles(mockApp, rollback);

    expect(failed).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledWith("copilot/custom-prompts/Gone.md", "original content");
  });

  it("returns failed paths on error", async () => {
    mockGetAbstractFileByPath.mockImplementation(() => {
      throw new Error("keychain locked");
    });

    const rollback = [
      { path: "copilot/test.md", previousContent: "content" },
    ];

    const failed = await rollbackVaultFiles(mockApp, rollback);

    expect(failed).toHaveLength(1);
    expect(failed[0]).toBe("copilot/test.md");
  });
});

