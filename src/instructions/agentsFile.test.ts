import { ensureAgentsFile, openAgentsFile } from "@/instructions/agentsFile";
import { App, TFile, TFolder } from "obsidian";

interface MockVaultState {
  files: Map<string, string>;
  folders: Set<string>;
}

function makeApp(initialFiles: Record<string, string> = {}, folders: string[] = []) {
  const state: MockVaultState = {
    files: new Map(Object.entries(initialFiles)),
    folders: new Set(folders),
  };
  const toFile = (path: string) => new (TFile as unknown as new (path: string) => TFile)(path);
  const toFolder = (path: string) =>
    new (TFolder as unknown as new (path: string) => TFolder)(path);
  const openFile = jest.fn().mockResolvedValue(undefined);
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn((path: string) => {
        if (state.files.has(path)) return toFile(path);
        if (state.folders.has(path)) return toFolder(path);
        return null;
      }),
      create: jest.fn(async (path: string, content: string) => {
        state.files.set(path, content);
        return toFile(path);
      }),
      read: jest.fn(async (file: TFile) => state.files.get(file.path) ?? ""),
      modify: jest.fn(async (file: TFile, content: string) => {
        state.files.set(file.path, content);
      }),
      adapter: {
        exists: jest.fn(async (path: string) => state.files.has(path)),
        read: jest.fn(async (path: string) => state.files.get(path) ?? ""),
        write: jest.fn(async (path: string, content: string) => {
          state.files.set(path, content);
        }),
        stat: jest.fn(async () => ({ ctime: 0, mtime: 0, size: 0 })),
      },
    },
    workspace: {
      getLeaf: jest.fn(() => ({ openFile })),
    },
  };
  return { app: app as unknown as App, state, openFile };
}

describe("agentsFile", () => {
  describe("ensureAgentsFile()", () => {
    it("creates root instruction files without changing the initial AGENTS content", async () => {
      const { app, state } = makeApp();

      await ensureAgentsFile(app, "", "");

      expect(state.files.get("AGENTS.md")).toBe("");
      expect(state.files.get("CLAUDE.md")).toBe("@AGENTS.md\n");
    });

    it("preserves existing files and appends only the missing Claude reference", async () => {
      const { app, state } = makeApp({
        "AGENTS.md": "User rules",
        "CLAUDE.md": "# Claude rules\n",
      });

      await ensureAgentsFile(app, "", "Fallback rules");
      await ensureAgentsFile(app, "", "Different fallback");

      expect(state.files.get("AGENTS.md")).toBe("User rules");
      expect(state.files.get("CLAUDE.md")).toBe("# Claude rules\n\n@AGENTS.md\n");
    });

    it("initializes a missing project AGENTS file from the supplied compatibility body", async () => {
      const { app, state } = makeApp({}, ["copilot/projects/Research"]);

      await ensureAgentsFile(app, "copilot/projects/Research", "Legacy project rules");

      expect(state.files.get("copilot/projects/Research/AGENTS.md")).toBe("Legacy project rules");
      expect(state.files.get("copilot/projects/Research/CLAUDE.md")).toBe("@AGENTS.md\n");
    });

    it("converts a generated mirror back to the current project.md instruction body", async () => {
      const marker =
        "<!-- copilot:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
      const { app, state } = makeApp({
        "Projects/Research/AGENTS.md": `${marker}\n\nExisting instructions`,
      });

      await ensureAgentsFile(app, "Projects/Research", "Fallback rules");

      expect(state.files.get("Projects/Research/AGENTS.md")).toBe("Fallback rules");
    });
  });

  describe("openAgentsFile()", () => {
    it("opens the ensured AGENTS file in the requested leaf", async () => {
      const { app, openFile } = makeApp();

      await openAgentsFile(app, "", "", true);

      expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
      expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "AGENTS.md" }));
    });
  });
});
