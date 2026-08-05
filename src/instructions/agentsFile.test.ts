import {
  agentsFileIsUninitialized,
  ensureAgentsFile,
  ensureAgentsFileForDiscovery,
  openAgentsFile,
} from "@/instructions/agentsFile";
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
      // Obsidian never indexes dot-folders, so those paths resolve only through the adapter —
      // the same split `vaultAdapterUtils` exists to bridge.
      getAbstractFileByPath: jest.fn((path: string) => {
        if (path.split("/").some((segment) => segment.startsWith("."))) return null;
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

    it("keeps a generated mirror's body when there is nothing to replace it with", async () => {
      // Once the project's legacy body has been moved out, later ensures pass "". Replacing
      // the mirror with that empties the only copy of the user's project instructions, and
      // the backend then reads a blank AGENTS.md.
      const marker =
        "<!-- copilot:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
      const { app, state } = makeApp({
        "Projects/Research/AGENTS.md": `${marker}\n\nExisting instructions`,
      });

      await ensureAgentsFile(app, "Projects/Research", "");

      expect(state.files.get("Projects/Research/AGENTS.md")).toBe("Existing instructions");
    });
  });

  describe("agentsFileIsUninitialized()", () => {
    it("is true when the file is absent", async () => {
      const { app } = makeApp();
      expect(await agentsFileIsUninitialized(app, "Projects/Research")).toBe(true);
    });

    it("is true for a generated mirror, which is Copilot's own output to replace", async () => {
      const marker =
        "<!-- copilot:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
      const { app } = makeApp({
        "Projects/Research/AGENTS.md": `${marker}\n\nExisting instructions`,
      });
      expect(await agentsFileIsUninitialized(app, "Projects/Research")).toBe(true);
    });

    it("is false once the file is the user's own", async () => {
      const { app } = makeApp({ "Projects/Research/AGENTS.md": "The user's own rules" });
      expect(await agentsFileIsUninitialized(app, "Projects/Research")).toBe(false);
    });
  });

  describe("ensureAgentsFileForDiscovery()", () => {
    it("initializes an old project so the backend discovers it without a manual open", async () => {
      // The regression this guards: a project whose instructions still live only in the
      // project.md body would otherwise send NO instructions to any backend until the user
      // happened to click the popover's AGENTS.md row.
      const { app, state } = makeApp({}, ["copilot/projects/Research"]);

      await ensureAgentsFileForDiscovery(app, "copilot/projects/Research", "Legacy project rules");

      expect(state.files.get("copilot/projects/Research/AGENTS.md")).toBe("Legacy project rules");
      expect(state.files.get("copilot/projects/Research/CLAUDE.md")).toBe("@AGENTS.md\n");
    });

    it("creates nothing for a scope with no instructions to preserve", async () => {
      const { app, state } = makeApp({}, ["copilot/projects/Fresh"]);

      await ensureAgentsFileForDiscovery(app, "copilot/projects/Fresh", "   \n ");

      expect(state.files.size).toBe(0);
    });

    it("adds the Claude import next to a user-authored AGENTS.md without a legacy body", async () => {
      const { app, state } = makeApp({ "AGENTS.md": "My vault rules" });

      await ensureAgentsFileForDiscovery(app, "", "");

      expect(state.files.get("AGENTS.md")).toBe("My vault rules");
      expect(state.files.get("CLAUDE.md")).toBe("@AGENTS.md\n");
    });

    it("never rejects when the vault write fails", async () => {
      const { app } = makeApp({}, ["copilot/projects/Research"]);
      (app.vault.create as jest.Mock).mockRejectedValue(new Error("disk full"));

      await expect(
        ensureAgentsFileForDiscovery(app, "copilot/projects/Research", "rules")
      ).resolves.toBeUndefined();
    });
  });

  describe("claude import detection", () => {
    it.each(["@AGENTS.md", "@./AGENTS.md", "# Rules\n\n@AGENTS.md\n\nmore"])(
      "does not duplicate the import for %p",
      async (claudeContent) => {
        const { app, state } = makeApp({ "AGENTS.md": "rules", "CLAUDE.md": claudeContent });

        await ensureAgentsFile(app, "", "");
        await ensureAgentsFile(app, "", "");

        expect(state.files.get("CLAUDE.md")).toBe(claudeContent);
      }
    );
  });

  describe("openAgentsFile()", () => {
    it("opens the ensured AGENTS file in the requested leaf", async () => {
      const { app, openFile } = makeApp();

      await openAgentsFile(app, "", "", true);

      expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
      expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "AGENTS.md" }));
    });

    it("reports the path instead of opening a file Obsidian cannot show", async () => {
      // A dot-folder file is never in the vault cache, so the resolved TFile is synthetic and
      // the editor would open an empty leaf.
      const { app, openFile } = makeApp({ ".copilot/projects/One/AGENTS.md": "rules" });

      await expect(openAgentsFile(app, ".copilot/projects/One", "", true)).rejects.toThrow(
        ".copilot/projects/One/AGENTS.md"
      );
      expect(openFile).not.toHaveBeenCalled();
    });
  });
});
