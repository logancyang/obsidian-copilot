import {
  getProjectConfigFilePath,
  getProjectFolderNameFromConfigPath,
  isProjectConfigFile,
} from "@/projects/projectPaths";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects" })),
}));

describe("getProjectConfigFilePath — single source of truth", () => {
  it("returns the project.md path under the project folder", () => {
    expect(getProjectConfigFilePath("MyProject")).toBe("copilot-projects/MyProject/project.md");
  });

  it("honors a root override", () => {
    expect(getProjectConfigFilePath("MyProject", "custom/root")).toBe(
      "custom/root/MyProject/project.md"
    );
  });
});

describe("isProjectConfigFile — project.md only (AGENTS.md is not a config)", () => {
  it("recognizes project.md", () => {
    expect(
      isProjectConfigFile(
        mockTFile({ path: "copilot-projects/Foo/project.md", name: "project.md", extension: "md" })
      )
    ).toBe(true);
  });

  it("does NOT recognize the generated AGENTS.md mirror as a config file", () => {
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

describe("getProjectFolderNameFromConfigPath", () => {
  it("extracts the folder from a project.md path", () => {
    expect(getProjectFolderNameFromConfigPath("copilot-projects/Foo/project.md")).toBe("Foo");
  });

  it("returns null for the AGENTS.md mirror (not a config path)", () => {
    expect(getProjectFolderNameFromConfigPath("copilot-projects/Foo/AGENTS.md")).toBeNull();
  });

  it("returns null for a non-config path", () => {
    expect(getProjectFolderNameFromConfigPath("copilot-projects/Foo/other.md")).toBeNull();
  });
});
