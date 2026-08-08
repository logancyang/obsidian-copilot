import { reconcileLegacyAgentsResidue } from "@/projects/legacyAgentsResidue";

jest.mock("@/projects/projectPaths", () => ({
  getProjectsFolder: () => "copilot-projects",
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

describe("legacyAgentsResidue", () => {
  describe("reconcileLegacyAgentsResidue()", () => {
    it("creates the missing project record and keeps AGENTS.md as body-only instructions", async () => {
      const agentsPath = "copilot-projects/Research/AGENTS.md";
      const projectPath = "copilot-projects/Research/project.md";
      const agentsContent = "---\ncopilot-project-id: research\n---\nUse primary sources.";
      const files = new Map([[agentsPath, agentsContent]]);
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

      await reconcileLegacyAgentsResidue(app);

      // The config lands in project.md verbatim (zero data loss)...
      expect(files.get(projectPath)).toBe(agentsContent);
      // ...while the surviving AGENTS.md keeps only the instruction body: its frontmatter is
      // project config, and feeding that YAML to the agent as instruction text is nonsense.
      expect(files.get(agentsPath)).toBe("Use primary sources.");
      expect(adapter.remove).not.toHaveBeenCalled();
    });
  });
});
