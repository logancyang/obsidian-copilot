import { reconcileLegacyAgentsResidue } from "@/projects/legacyAgentsResidue";

jest.mock("@/projects/projectPaths", () => ({
  getProjectsFolder: () => "copilot-projects",
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

function makeVault(initialFiles: Record<string, string>) {
  const files = new Map(Object.entries(initialFiles));
  const adapter = {
    exists: jest.fn(async (path: string) => path === "copilot-projects" || files.has(path)),
    list: jest.fn(async () => ({
      files: [],
      folders: ["copilot-projects/Research"],
    })),
    read: jest.fn(async (path: string) => files.get(path) ?? ""),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    remove: jest.fn(),
  };
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn(() => null),
      adapter,
    },
  } as never;
  return { app, files, adapter };
}

describe("legacyAgentsResidue", () => {
  describe("reconcileLegacyAgentsResidue()", () => {
    const agentsPath = "copilot-projects/Research/AGENTS.md";
    const projectPath = "copilot-projects/Research/project.md";

    it("creates the missing project record and keeps AGENTS.md as body-only instructions", async () => {
      const agentsContent = "---\ncopilot-project-id: research\n---\nUse primary sources.";
      const { app, files, adapter } = makeVault({ [agentsPath]: agentsContent });

      await reconcileLegacyAgentsResidue(app);

      expect(files.get(projectPath)).toBe(agentsContent);
      expect(files.get(agentsPath)).toBe("Use primary sources.");
      expect(adapter.remove).not.toHaveBeenCalled();
    });

    it("leaves a folder untouched when its project.md already exists", async () => {
      const agentsContent = "---\ncopilot-project-id: research\n---\nUse primary sources.";
      const { app, files } = makeVault({
        [agentsPath]: agentsContent,
        [projectPath]: "existing project record",
      });

      await reconcileLegacyAgentsResidue(app);

      expect(files.get(projectPath)).toBe("existing project record");
      expect(files.get(agentsPath)).toBe(agentsContent);
    });

    it("leaves a user-authored AGENTS.md without a copilot-project-id untouched", async () => {
      const { app, files } = makeVault({ [agentsPath]: "Plain instructions" });

      await reconcileLegacyAgentsResidue(app);

      expect(files.has(projectPath)).toBe(false);
      expect(files.get(agentsPath)).toBe("Plain instructions");
    });
  });
});
