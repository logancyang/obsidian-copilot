import {
  getProjectAnchorFromConfigPath,
  getProjectConfigFilePath,
  getProjectFolderNameFromConfigPath,
  isProjectConfigFile,
} from "@/projects/projectPaths";
import { getEffectiveProjectsFolder } from "@/settings/copilotFolder";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveProjectsFolder: jest.fn(() => "copilot-projects"),
}));
describe("projectPaths", () => {
  describe("getProjectConfigFilePath()", () => {
    it("returns the project.md path under the project folder", () => {
      expect(getProjectConfigFilePath("MyProject")).toBe("copilot-projects/MyProject/project.md");
    });

    it("honors a root override", () => {
      expect(getProjectConfigFilePath("MyProject", "custom/root")).toBe(
        "custom/root/MyProject/project.md"
      );
    });
  });

  describe("getProjectAnchorFromConfigPath()", () => {
    it("resolves a project's tree from its own config path, ignoring the live root", () => {
      const anchor = getProjectAnchorFromConfigPath("old-root/projects/My Project/project.md");

      expect(anchor.projectFolderPath).toBe("old-root/projects/My Project");
      expect(anchor.projectsRoot).toBe("old-root/projects");
    });

    it("throws on a path too shallow to name a tree instead of inventing one", () => {
      expect(() => getProjectAnchorFromConfigPath("project.md")).toThrow(
        'Not a project config path: "project.md"'
      );
    });

    it("is unaffected by the configured root moving", () => {
      const mockedRoot = getEffectiveProjectsFolder as jest.Mock;
      mockedRoot.mockReturnValue("new-root/projects");
      try {
        const anchor = getProjectAnchorFromConfigPath("old-root/projects/Alpha/project.md");

        expect(anchor.projectsRoot).toBe("old-root/projects");
      } finally {
        mockedRoot.mockReturnValue("copilot-projects");
      }
    });
  });

  describe("isProjectConfigFile()", () => {
    it("recognizes project.md", () => {
      expect(
        isProjectConfigFile(
          mockTFile({
            path: "copilot-projects/Foo/project.md",
            name: "project.md",
            extension: "md",
          })
        )
      ).toBe(true);
    });

    it("does NOT recognize AGENTS.md as a config file", () => {
      expect(
        isProjectConfigFile(
          mockTFile({ path: "copilot-projects/Foo/AGENTS.md", name: "AGENTS.md", extension: "md" })
        )
      ).toBe(false);
    });

    it("rejects files under the unsupported/ backup folder", () => {
      expect(
        isProjectConfigFile(
          mockTFile({
            path: "copilot-projects/unsupported/project.md",
            name: "project.md",
            extension: "md",
          })
        )
      ).toBe(false);
    });

    it("rejects an unrecognized config file name at the right depth", () => {
      expect(
        isProjectConfigFile(
          mockTFile({ path: "copilot-projects/Foo/notes.md", name: "notes.md", extension: "md" })
        )
      ).toBe(false);
    });

    it("rejects files nested too deep", () => {
      expect(
        isProjectConfigFile(
          mockTFile({
            path: "copilot-projects/Foo/sub/project.md",
            name: "project.md",
            extension: "md",
          })
        )
      ).toBe(false);
    });
  });

  describe("getProjectFolderNameFromConfigPath()", () => {
    it("extracts the folder from a project.md path", () => {
      expect(getProjectFolderNameFromConfigPath("copilot-projects/Foo/project.md")).toBe("Foo");
    });

    it("returns null for AGENTS.md (not a config path)", () => {
      expect(getProjectFolderNameFromConfigPath("copilot-projects/Foo/AGENTS.md")).toBeNull();
    });

    it("returns null for a non-config path", () => {
      expect(getProjectFolderNameFromConfigPath("copilot-projects/Foo/other.md")).toBeNull();
    });
  });
});
