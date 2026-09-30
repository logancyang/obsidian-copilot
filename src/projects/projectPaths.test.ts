import {
  deriveProjectFolderName,
  getProjectAnchorFromConfigPath,
  getProjectConfigFilePath,
  getProjectFolderNameFromConfigPath,
  getProjectFolderPath,
  getProjectsFolder,
  getProjectsUnsupportedFolder,
  isProjectConfigFile,
  readFrontmatterFieldFromFile,
  sanitizeVaultPathSegment,
  splitUrlsStringToArray,
} from "@/projects/projectPaths";
import type { Vault } from "obsidian";
import { getEffectiveProjectsFolder } from "@/settings/copilotFolder";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveProjectsFolder: jest.fn(() => "copilot-projects"),
}));
describe("projectPaths", () => {
  describe("getProjectsFolder()", () => {
    it("returns the effective projects folder", () => {
      expect(getProjectsFolder()).toBe("copilot-projects");
    });
  });

  describe("getProjectsUnsupportedFolder()", () => {
    it("returns the unsupported backup folder under the projects folder", () => {
      expect(getProjectsUnsupportedFolder()).toBe("copilot-projects/unsupported");
    });
  });

  describe("getProjectFolderPath()", () => {
    it("returns the project's folder under the projects folder", () => {
      expect(getProjectFolderPath("MyProject")).toBe("copilot-projects/MyProject");
    });
  });

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
  describe("sanitizeVaultPathSegment()", () => {
    it("keeps an ordinary name unchanged", () => {
      expect(sanitizeVaultPathSegment("My Project")).toBe("My Project");
    });

    it("replaces every character that is invalid in a file name with an underscore", () => {
      expect(sanitizeVaultPathSegment('<>:"/\\|?*')).toBe("_________");
      expect(sanitizeVaultPathSegment("My Project: v1.0 <beta>")).toBe("My Project_ v1.0 _beta_");
    });

    it("blocks path traversal by replacing separators", () => {
      expect(sanitizeVaultPathSegment("../foo")).toBe(".._foo");
    });

    it("replaces control characters with underscores", () => {
      expect(sanitizeVaultPathSegment("abc\x00def")).toBe("abc_def");
      expect(sanitizeVaultPathSegment("test\x1Fname")).toBe("test_name");
    });

    it("preserves CJK characters, emoji, and interior dots", () => {
      expect(sanitizeVaultPathSegment("我的项目")).toBe("我的项目");
      expect(sanitizeVaultPathSegment("プロジェクト")).toBe("プロジェクト");
      expect(sanitizeVaultPathSegment("🎵 Piano Notes")).toBe("🎵 Piano Notes");
      expect(sanitizeVaultPathSegment("foo..bar")).toBe("foo..bar");
    });

    it("does not truncate long names", () => {
      const longName = "a".repeat(300);
      expect(sanitizeVaultPathSegment(longName)).toBe(longName);
    });

    it("strips trailing dots and spaces (Windows compatibility)", () => {
      expect(sanitizeVaultPathSegment("project...")).toBe("project");
      expect(sanitizeVaultPathSegment("project   ")).toBe("project");
      expect(sanitizeVaultPathSegment("project. . .")).toBe("project");
    });

    it("prefixes Windows reserved device names with an underscore", () => {
      expect(sanitizeVaultPathSegment("CON")).toBe("_CON");
      expect(sanitizeVaultPathSegment("prn")).toBe("_prn");
      expect(sanitizeVaultPathSegment("COM1")).toBe("_COM1");
      expect(sanitizeVaultPathSegment("LPT9")).toBe("_LPT9");
    });

    it.each([[""], ["   "], ["."], [".."]])(
      "falls back to a single underscore for the unusable name %j",
      (input) => {
        expect(sanitizeVaultPathSegment(input)).toBe("_");
      }
    );

    it("maps names that differ only in invalid characters to the same segment", () => {
      expect(sanitizeVaultPathSegment("a/b")).toBe(sanitizeVaultPathSegment("a|b"));
      expect(sanitizeVaultPathSegment("***")).toBe(sanitizeVaultPathSegment("???"));
    });
  });

  describe("deriveProjectFolderName()", () => {
    it("uses the project name when available", () => {
      expect(deriveProjectFolderName("id-123", "My Project")).toBe("My Project");
    });

    it("falls back to the project id when the name is missing, empty, or whitespace-only", () => {
      expect(deriveProjectFolderName("id-123")).toBe("id-123");
      expect(deriveProjectFolderName("id-123", "")).toBe("id-123");
      expect(deriveProjectFolderName("id-123", "   ")).toBe("id-123");
    });

    it("sanitizes special characters in the project name", () => {
      expect(deriveProjectFolderName("id-1", "My/Project: v1")).toBe("My_Project_ v1");
    });

    it("preserves CJK and emoji in project names", () => {
      expect(deriveProjectFolderName("id-1", "我的项目")).toBe("我的项目");
      expect(deriveProjectFolderName("id-1", "🎵 Music")).toBe("🎵 Music");
    });

    it("prefixes the reserved unsupported folder name with an underscore in any letter case", () => {
      expect(deriveProjectFolderName("id-1", "unsupported")).toBe("_unsupported");
      expect(deriveProjectFolderName("id-1", "Unsupported")).toBe("_Unsupported");
      expect(deriveProjectFolderName("id-1", "UNSUPPORTED")).toBe("_UNSUPPORTED");
    });
  });

  describe("splitUrlsStringToArray()", () => {
    it("splits on newlines, trims each entry, and drops blank lines", () => {
      expect(splitUrlsStringToArray("  https://a.com \n\n https://b.com\n")).toEqual([
        "https://a.com",
        "https://b.com",
      ]);
    });

    it("returns an empty array for an empty string", () => {
      expect(splitUrlsStringToArray("")).toEqual([]);
    });
  });

  describe("readFrontmatterFieldFromFile()", () => {
    const readField = async (raw: string | Error, key: string): Promise<string> => {
      const vault = {
        cachedRead: jest.fn(async () => {
          if (raw instanceof Error) throw raw;
          return raw;
        }),
      } as unknown as Vault;
      return readFrontmatterFieldFromFile(vault, mockTFile({ path: "a/project.md" }), key);
    };

    it("returns the raw value of a frontmatter key", async () => {
      await expect(
        readField("---\ncopilot-project-id: my-project\n---\nBody", "copilot-project-id")
      ).resolves.toBe("my-project");
    });

    it("unquotes quoted values and strips trailing inline comments", async () => {
      await expect(readField('---\nname: "Quoted Name"\n---\n', "name")).resolves.toBe(
        "Quoted Name"
      );
      await expect(readField("---\nname: plain # note\n---\n", "name")).resolves.toBe("plain");
    });

    it("returns an empty string when the key, the frontmatter, or the file is missing", async () => {
      await expect(readField("---\nother: 1\n---\n", "name")).resolves.toBe("");
      await expect(readField("No frontmatter here", "name")).resolves.toBe("");
      await expect(readField(new Error("read failed"), "name")).resolves.toBe("");
    });
  });
});
