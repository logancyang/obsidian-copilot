import * as searchUtils from "@/search/searchUtils";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import { ToolManager } from "@/tools/toolManager";
import { App, TFile, TFolder } from "obsidian";
import { buildFileTree, createGetFileTreeTool } from "./FileTreeTools";

const mockApp = {} as unknown as App;

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(),
  shouldIndexFile: jest.fn(),
}));

function makeFolder(path: string, parent: TFolder | null, children: (TFile | TFolder)[]): TFolder {
  const folder = mockTFolder({ path, name: path.split("/").pop() ?? "", parent, children });
  return folder;
}

function makeFile(path: string, parent: TFolder): TFile {
  const name = path.split("/").pop() ?? "";
  const basename = name.includes(".") ? name.split(".")[0] : name;
  const extension = name.includes(".") ? (name.split(".")[1] ?? "") : "";
  return mockTFile({
    path,
    name,
    basename,
    extension,
    parent,
    stat: { ctime: Date.now(), mtime: Date.now(), size: 0 },
  });
}

describe("FileTreeTools", () => {
  let root: TFolder;

  beforeEach(() => {
    root = mockTFolder({ path: "", name: "", parent: null, children: [] });

    const docs = makeFolder("docs", root, []);
    const projects = makeFolder("docs/projects", docs, []);
    const notes = makeFolder("docs/notes", docs, []);

    (projects as TFolder & { children: (TFile | TFolder)[] }).children = [
      makeFile("docs/projects/project1.md", projects),
      makeFile("docs/projects/project2.md", projects),
      makeFile("docs/projects/data.json", projects),
    ];

    (notes as TFolder & { children: (TFile | TFolder)[] }).children = [
      makeFile("docs/notes/note1.md", notes),
      makeFile("docs/notes/note2.md", notes),
      makeFile("docs/notes/image.png", notes),
    ];

    (docs as TFolder & { children: (TFile | TFolder)[] }).children = [
      projects,
      notes,
      makeFile("docs/readme.md", docs),
    ];

    (root as TFolder & { children: (TFile | TFolder)[] }).children = [
      docs,
      makeFile("readme.md", root),
      makeFile("config.json", root),
      makeFile("text", root),
    ];

    jest.clearAllMocks();

    (searchUtils.getMatchingPatterns as jest.Mock).mockReturnValue({
      inclusions: null,
      exclusions: null,
    });
    (searchUtils.shouldIndexFile as jest.Mock).mockReturnValue(true);
  });

  it("should generate correct file tree structure with files and extension counts", async () => {
    const tree = buildFileTree(mockApp, root);

    const expectedTree = {
      vault: {
        files: ["readme.md", "config.json", "text"],
        subFolders: {
          docs: {
            files: ["readme.md"],
            subFolders: {
              projects: {
                files: ["project1.md", "project2.md", "data.json"],
                extensionCounts: { md: 2, json: 1 },
              },
              notes: {
                files: ["note1.md", "note2.md", "image.png"],
                extensionCounts: { md: 2, png: 1 },
              },
            },
            extensionCounts: { md: 5, json: 1, png: 1 },
          },
        },
        extensionCounts: { md: 6, json: 2, png: 1, unknown: 1 },
      },
    };

    expect(tree).toEqual(expectedTree);

    const tool = createGetFileTreeTool(mockApp, root);
    const result = (await ToolManager.callTool(tool, {})) as string;

    const jsonPart = result.substring(result.indexOf("{"));
    const treeFromTool = JSON.parse(jsonPart) as typeof expectedTree;

    expect(treeFromTool).toEqual(expectedTree);
  });

  it("should handle size limit by rebuilding without files", async () => {
    const tree = buildFileTree(mockApp, root, false);

    const expectedTree = {
      vault: {
        subFolders: {
          docs: {
            subFolders: {
              projects: {
                extensionCounts: { md: 2, json: 1 },
              },
              notes: {
                extensionCounts: { md: 2, png: 1 },
              },
            },
            extensionCounts: { md: 5, json: 1, png: 1 },
          },
        },
        extensionCounts: { md: 6, json: 2, png: 1, unknown: 1 },
      },
    };

    expect(tree).toEqual(expectedTree);
  });

  it("should exclude files based on patterns", async () => {
    (searchUtils.shouldIndexFile as jest.Mock).mockImplementation(
      (_app: unknown, file: { path: string }) => {
        return !file.path.includes("projects");
      }
    );

    const tree = buildFileTree(mockApp, root);

    const expectedTree = {
      vault: {
        files: ["readme.md", "config.json", "text"],
        subFolders: {
          docs: {
            files: ["readme.md"],
            subFolders: {
              notes: {
                files: ["note1.md", "note2.md", "image.png"],
                extensionCounts: { md: 2, png: 1 },
              },
            },
            extensionCounts: { md: 3, png: 1 },
          },
        },
        extensionCounts: { md: 4, png: 1, json: 1, unknown: 1 },
      },
    };

    expect(tree).toEqual(expectedTree);
  });

  it("should handle empty folders after filtering", async () => {
    (searchUtils.shouldIndexFile as jest.Mock).mockReturnValue(false);

    const tree = buildFileTree(mockApp, root);

    const expectedTree = {};

    expect(tree).toEqual(expectedTree);
  });
});
