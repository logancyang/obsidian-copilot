import { resolveObsidianCliPath } from "./obsidianCliPath";

describe("obsidianCliPath", () => {
  describe("resolveObsidianCliPath()", () => {
    it("uses the Windows terminal redirector beside the running GUI executable", () => {
      const checked: string[] = [];

      expect(
        resolveObsidianCliPath({
          platform: "win32",
          resourcesPath: "C:\\Users\\Me\\App Data\\Obsidian\\resources",
          homeDir: "C:\\Users\\Me",
          isExecutable: (candidate) => {
            checked.push(candidate);
            return true;
          },
        })
      ).toBe("C:/Users/Me/App Data/Obsidian/Obsidian.com");
      expect(checked).toEqual(["C:/Users/Me/App Data/Obsidian/Obsidian.com"]);
    });

    it("uses the bundled macOS CLI rather than the app executable", () => {
      expect(
        resolveObsidianCliPath({
          platform: "darwin",
          resourcesPath: "/Applications/Obsidian Beta.app/Contents/Resources",
          homeDir: "/Users/me",
          isExecutable: () => true,
        })
      ).toBe("/Applications/Obsidian Beta.app/Contents/MacOS/obsidian-cli");
    });

    it("prefers the current Linux install and falls back to the registered user copy", () => {
      const input = {
        platform: "linux" as const,
        resourcesPath: "/tmp/.mount Obsidian/resources",
        homeDir: "/home/me",
      };

      expect(resolveObsidianCliPath({ ...input, isExecutable: () => true })).toBe(
        "/tmp/.mount Obsidian/obsidian-cli"
      );
      expect(
        resolveObsidianCliPath({
          ...input,
          isExecutable: (candidate) => candidate === "/home/me/.local/bin/obsidian",
        })
      ).toBe("/home/me/.local/bin/obsidian");
    });

    it("returns null when no supported executable is available", () => {
      expect(
        resolveObsidianCliPath({
          platform: "darwin",
          homeDir: "/Users/me",
          isExecutable: () => true,
        })
      ).toBeNull();
      expect(
        resolveObsidianCliPath({
          platform: "win32",
          resourcesPath: "C:\\Program Files\\Obsidian\\resources",
          homeDir: "C:\\Users\\me",
          isExecutable: () => false,
        })
      ).toBeNull();
      expect(
        resolveObsidianCliPath({
          platform: "freebsd",
          resourcesPath: "/usr/local/lib/obsidian/resources",
          homeDir: "/home/me",
          isExecutable: () => true,
        })
      ).toBeNull();
    });
  });
});
