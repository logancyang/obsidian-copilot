import { logFileManager } from "@/logFileManager";
import type { App } from "obsidian";

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveCopilotFolder: () => "copilot",
}));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ debug: true, openAIApiKey: "sk-should-never-be-exported" }),
}));
jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn().mockResolvedValue(undefined),
}));

interface FakeVault {
  exists: jest.Mock<Promise<boolean>, [string]>;
  write: jest.Mock<Promise<void>, [string, string]>;
  remove: jest.Mock<Promise<void>, [string]>;
  create: jest.Mock<Promise<void>, [string, string]>;
}

function fakeApp(existing: boolean): { app: App; vault: FakeVault } {
  const vault: FakeVault = {
    exists: jest.fn<Promise<boolean>, [string]>(async () => existing),
    write: jest.fn<Promise<void>, [string, string]>(async () => {}),
    remove: jest.fn<Promise<void>, [string]>(async () => {}),
    create: jest.fn<Promise<void>, [string, string]>(async () => {}),
  };
  const app = {
    vault: {
      adapter: { exists: vault.exists, write: vault.write, remove: vault.remove },
      create: vault.create,
      getAbstractFileByPath: () => null,
    },
    workspace: { getLeaf: () => ({ openFile: jest.fn() }) },
  } as unknown as App;
  return { app, vault };
}

describe("logFileManager", () => {
  // The manager is a module-level singleton, so each test starts from a wiped
  // buffer rather than inheriting the previous one's entries.
  beforeEach(async () => {
    logFileManager.setApp(fakeApp(false).app);
    await logFileManager.clear();
  });

  describe("exportLogText()", () => {
    it("returns an empty string before anything has been logged", () => {
      expect(logFileManager.exportLogText()).toBe("");
    });

    it("returns the buffered entries as newline-terminated text", async () => {
      await logFileManager.append("INFO", "first");
      await logFileManager.append("ERROR", "second");

      const text = logFileManager.exportLogText();
      expect(text).toContain("INFO first");
      expect(text).toContain("ERROR second");
      expect(text.endsWith("\n")).toBe(true);
    });

    it("includes raw Markdown blocks appended alongside timestamped entries", async () => {
      await logFileManager.appendMarkdownBlock(["| a | b |", "| - | - |"]);
      expect(logFileManager.exportLogText()).toContain("| a | b |");
    });

    it("omits the settings dump that openLogFile() attaches, so no keys can leak", async () => {
      await logFileManager.append("INFO", "hello");
      const text = logFileManager.exportLogText();

      expect(text).not.toContain("## Settings");
      expect(text).not.toContain("sk-should-never-be-exported");
    });

    it("leaves the buffer intact so a later export or flush sees the same entries", async () => {
      await logFileManager.append("INFO", "hello");
      expect(logFileManager.exportLogText()).toBe(logFileManager.exportLogText());
    });

    it("reports nothing to export after the log is cleared", async () => {
      await logFileManager.append("INFO", "hello");
      await logFileManager.clear();
      expect(logFileManager.exportLogText()).toBe("");
    });

    it("does not create the vault log note", async () => {
      const { app, vault } = fakeApp(false);
      logFileManager.setApp(app);
      await logFileManager.append("INFO", "hello");

      logFileManager.exportLogText();
      expect(vault.create).not.toHaveBeenCalled();
      expect(vault.write).not.toHaveBeenCalled();
    });
  });

  describe("flush()", () => {
    it("writes the buffer when the log note already exists", async () => {
      const { app, vault } = fakeApp(true);
      logFileManager.setApp(app);
      await logFileManager.append("INFO", "hello");

      await logFileManager.flush();
      expect(vault.write).toHaveBeenCalledWith(
        "copilot/copilot-log.md",
        expect.stringContaining("hello")
      );
    });

    it("creates nothing when the log note does not exist yet", async () => {
      const { app, vault } = fakeApp(false);
      logFileManager.setApp(app);
      await logFileManager.append("INFO", "hello");

      await logFileManager.flush();
      expect(vault.write).not.toHaveBeenCalled();
      expect(vault.create).not.toHaveBeenCalled();
    });
  });

  describe("openLogFile()", () => {
    it("creates the note with the buffer plus a sanitized settings block", async () => {
      const { app, vault } = fakeApp(false);
      logFileManager.setApp(app);
      await logFileManager.append("INFO", "hello");

      await logFileManager.openLogFile();
      expect(vault.create).toHaveBeenCalledTimes(1);
      const content = vault.create.mock.calls[0][1];
      expect(content).toContain("hello");
      expect(content).toContain("## Settings");
      // Sensitive keys are stripped from the dump it appends.
      expect(content).not.toContain("sk-should-never-be-exported");
    });

    it("keeps the settings block out of the in-memory buffer", async () => {
      const { app } = fakeApp(false);
      logFileManager.setApp(app);
      await logFileManager.append("INFO", "hello");

      await logFileManager.openLogFile();
      expect(logFileManager.exportLogText()).not.toContain("## Settings");
    });
  });

  describe("getLogPath()", () => {
    it("resolves the note under the effective Copilot root folder", () => {
      expect(logFileManager.getLogPath()).toBe("copilot/copilot-log.md");
    });
  });
});
