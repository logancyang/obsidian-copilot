import { moveProjectPromptToAgentsFile } from "@/projects/moveProjectPrompt";
import type { ProjectFileRecord } from "@/projects/type";
import { App, TFile, TFolder } from "obsidian";

const mockUpdateProject = jest.fn(async () => undefined);

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: () => ({ updateProject: mockUpdateProject }) },
}));

jest.mock("@/projects/projectPaths", () => ({
  getProjectAnchorFromConfigPath: (configPath: string) => ({
    projectFolderPath: configPath.split("/").slice(0, -1).join("/"),
    projectsRoot: configPath.split("/").slice(0, -2).join("/"),
  }),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makeApp(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const toFile = (path: string) => new (TFile as unknown as new (path: string) => TFile)(path);
  const toFolder = (path: string) =>
    new (TFolder as unknown as new (path: string) => TFolder)(path);
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn((path: string) => {
        if (files.has(path)) return toFile(path);
        return path.includes("/") && !path.endsWith(".md") ? toFolder(path) : null;
      }),
      getFiles: jest.fn(() => [...files.keys()].map(toFile)),
      create: jest.fn(async (path: string, content: string) => {
        files.set(path, content);
        return toFile(path);
      }),
      read: jest.fn(async (file: TFile) => files.get(file.path) ?? ""),
      modify: jest.fn(async (file: TFile, content: string) => {
        files.set(file.path, content);
      }),
      adapter: {
        exists: jest.fn(async (path: string) => files.has(path)),
        read: jest.fn(async (path: string) => files.get(path) ?? ""),
        write: jest.fn(async (path: string, content: string) => {
          files.set(path, content);
        }),
        stat: jest.fn(async () => ({ ctime: 0, mtime: 0, size: 0 })),
      },
    },
  };
  return { app: app as unknown as App, files };
}

function makeRecord(systemPrompt: string, filePath = "copilot-projects/Research/project.md") {
  return {
    folderName: "Research",
    filePath,
    project: { id: "p1", name: "Research", systemPrompt },
  } as unknown as ProjectFileRecord;
}

const MIRROR_HEADER = "<!-- copilot:generated-agents-mirror v1 -->\n\n";

describe("moveProjectPrompt", () => {
  describe("moveProjectPromptToAgentsFile()", () => {
    beforeEach(() => {
      mockUpdateProject.mockClear();
      mockUpdateProject.mockResolvedValue(undefined);
    });

    it("writes the project's prompt text into AGENTS.md and clears it from project.md", async () => {
      const { app, files } = makeApp();

      await moveProjectPromptToAgentsFile(app, makeRecord("Cite every source."));

      expect(files.get("copilot-projects/Research/AGENTS.md")).toBe("Cite every source.");
      expect(mockUpdateProject).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ systemPrompt: "" })
      );
    });

    it("leaves a project with no prompt text untouched", async () => {
      const { app, files } = makeApp();

      await moveProjectPromptToAgentsFile(app, makeRecord("   "));

      expect(files.has("copilot-projects/Research/AGENTS.md")).toBe(false);
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    it("writes beside the record's own project.md, not under the live projects root", async () => {
      // A Copilot-folder change activates before ProjectRegister reloads its cache, so a
      // record can name the old tree while the live root already names the new one. The
      // session cwd follows the record, so the file has to as well.
      const { app, files } = makeApp();

      await moveProjectPromptToAgentsFile(
        app,
        makeRecord("Cite every source.", "old-root/projects/Research/project.md")
      );

      expect(files.get("old-root/projects/Research/AGENTS.md")).toBe("Cite every source.");
      expect(files.has("copilot-projects/Research/AGENTS.md")).toBe(false);
    });

    it("converts a legacy generated mirror rather than treating it as the user's file", async () => {
      // The mirror is Copilot's own output. Leaving it in place would strand the legacy text
      // AND leave the mirror for a later blank ensure to overwrite.
      const { app, files } = makeApp({
        "copilot-projects/Research/AGENTS.md": `${MIRROR_HEADER}stale generated body`,
      });

      await moveProjectPromptToAgentsFile(app, makeRecord("Cite every source."));

      expect(files.get("copilot-projects/Research/AGENTS.md")).toBe("Cite every source.");
      expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    });

    it("never overwrites an existing AGENTS.md, and leaves project.md alone when it cannot", async () => {
      const { app, files } = makeApp({
        "copilot-projects/Research/AGENTS.md": "The user's own instructions",
      });

      await moveProjectPromptToAgentsFile(app, makeRecord("Stale legacy text"));

      expect(files.get("copilot-projects/Research/AGENTS.md")).toBe("The user's own instructions");
      // Clearing here would delete the legacy text with nowhere to have moved it.
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    it("runs only once: the second pass sees the file it just wrote", async () => {
      const { app, files } = makeApp();
      const record = makeRecord("Cite every source.");

      await moveProjectPromptToAgentsFile(app, record);
      // The caller re-reads the record from cache, so a stale copy can carry the old text.
      await moveProjectPromptToAgentsFile(app, record);

      expect(files.get("copilot-projects/Research/AGENTS.md")).toBe("Cite every source.");
      expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    });

    it("keeps the text in project.md when the AGENTS.md write fails", async () => {
      const { app } = makeApp();
      (app.vault.create as jest.Mock).mockRejectedValue(new Error("vault is read-only"));
      (app.vault.adapter.write as jest.Mock).mockRejectedValue(new Error("vault is read-only"));

      await moveProjectPromptToAgentsFile(app, makeRecord("Cite every source."));

      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    it("does not reject when clearing project.md fails", async () => {
      const { app, files } = makeApp();
      mockUpdateProject.mockRejectedValue(new Error("write conflict"));

      await expect(
        moveProjectPromptToAgentsFile(app, makeRecord("Cite every source."))
      ).resolves.toBeUndefined();

      expect(files.get("copilot-projects/Research/AGENTS.md")).toBe("Cite every source.");
    });
  });
});
