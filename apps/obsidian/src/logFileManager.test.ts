import { logFileManager } from "@/logFileManager";
import { getSettings } from "@/settings/model";
import { Notice, type App } from "obsidian";

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveCopilotFolder: () => "copilot",
}));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: true, openAIApiKey: "sk-should-never-be-exported" })),
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
  beforeEach(async () => {
    logFileManager.setApp(fakeApp(false).app);
    await logFileManager.clear();
  });

  describe("LogFileManager", () => {
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

      it("resolves without throwing when the vault write fails", async () => {
        const { app, vault } = fakeApp(true);
        vault.write.mockRejectedValueOnce(new Error("disk full"));
        logFileManager.setApp(app);
        await logFileManager.append("INFO", "hello");

        await expect(logFileManager.flush()).resolves.toBeUndefined();
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
        expect(content).not.toContain("sk-should-never-be-exported");
      });

      it("keeps the settings block out of the in-memory buffer", async () => {
        const { app } = fakeApp(false);
        logFileManager.setApp(app);
        await logFileManager.append("INFO", "hello");

        await logFileManager.openLogFile();
        expect(logFileManager.exportLogText()).not.toContain("## Settings");
      });

      it("still writes the buffered log when the settings cannot be serialized", async () => {
        const { app, vault } = fakeApp(false);
        jest.mocked(getSettings).mockReturnValueOnce({ debug: true, big: BigInt(1) } as never);
        logFileManager.setApp(app);
        await logFileManager.append("INFO", "hello");

        await logFileManager.openLogFile();
        const content = vault.create.mock.calls[0][1];
        expect(content).toContain("hello");
        expect(content).toContain("Settings could not be serialized: TypeError");
      });

      it("shows a notice when the note cannot be written, since the logger cannot log its own failure (https://github.com/Brevilabs/obsidian-copilot-private/issues/647)", async () => {
        const { app, vault } = fakeApp(false);
        vault.create.mockRejectedValueOnce(new Error("read-only vault"));
        logFileManager.setApp(app);

        await logFileManager.openLogFile();
        expect(Notice).toHaveBeenCalledWith(
          "Could not write the Copilot log file: Error: read-only vault"
        );
      });
    });

    describe("getLogPath()", () => {
      it("resolves the note under the effective Copilot root folder", () => {
        expect(logFileManager.getLogPath()).toBe("copilot/copilot-log.md");
      });
    });
  });
});
