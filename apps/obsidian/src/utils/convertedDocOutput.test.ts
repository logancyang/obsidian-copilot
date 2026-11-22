import { TFile, Vault } from "obsidian";
import { saveConvertedDocOutput } from "./convertedDocOutput";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("obsidian", () => ({
  TFile: class {},
  Vault: class {},
}));

function makeTFile(path: string): TFile {
  const parts = path.split("/");
  const filename = parts[parts.length - 1];
  const basename = filename.replace(/\.[^.]+$/, "");
  const extension = filename.split(".").pop() ?? "";
  return mockTFile({ path, basename, extension });
}

function makeVaultAdapter() {
  const files: Record<string, string> = {};
  return {
    files,
    exists: jest.fn(async (p: string) => p in files),
    read: jest.fn(async (p: string) => files[p] ?? ""),
    write: jest.fn(async (p: string, content: string) => {
      files[p] = content;
    }),
  };
}

function makeVault(adapter: ReturnType<typeof makeVaultAdapter>): Vault {
  return { adapter } as unknown as Vault;
}

describe("convertedDocOutput", () => {
  describe("saveConvertedDocOutput()", () => {
    it("writes {basename}.md into the output folder with a source header", async () => {
      const adapter = makeVaultAdapter();
      const vault = makeVault(adapter);
      await saveConvertedDocOutput(
        makeTFile("docs/report.pdf"),
        "parsed markdown",
        vault,
        "output"
      );
      expect(adapter.write).toHaveBeenCalledWith(
        "output/report.md",
        "<!-- source: docs/report.pdf -->\nparsed markdown"
      );
    });

    it.each([
      ["the output folder is empty", "docs/report.pdf", "content", ""],
      ["the output folder is whitespace", "docs/report.pdf", "content", "   "],
      ["the source file is markdown", "notes/note.md", "content", "output"],
      ["the converted content is empty", "docs/report.pdf", "", "output"],
      ["the converted content is an error string", "docs/report.pdf", "[Error: failed]", "output"],
    ])("writes nothing when %s", async (_case, sourcePath, content, outputFolder) => {
      const adapter = makeVaultAdapter();
      await saveConvertedDocOutput(
        makeTFile(sourcePath),
        content,
        makeVault(adapter),
        outputFolder
      );
      expect(adapter.write).not.toHaveBeenCalled();
    });

    it("skips the write when the existing file already has identical content", async () => {
      const adapter = makeVaultAdapter();
      adapter.files["output/report.md"] = "<!-- source: docs/report.pdf -->\nparsed markdown";
      const vault = makeVault(adapter);
      await saveConvertedDocOutput(
        makeTFile("docs/report.pdf"),
        "parsed markdown",
        vault,
        "output"
      );
      expect(adapter.write).not.toHaveBeenCalled();
    });

    it("overwrites the existing file when the same source produced new content", async () => {
      const adapter = makeVaultAdapter();
      adapter.files["output/report.md"] = "<!-- source: docs/report.pdf -->\nold content";
      const vault = makeVault(adapter);
      await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "new content", vault, "output");
      expect(adapter.write).toHaveBeenCalledWith(
        "output/report.md",
        "<!-- source: docs/report.pdf -->\nnew content"
      );
    });

    it("writes to a path-derived name when the basename is taken by a different source", async () => {
      const adapter = makeVaultAdapter();
      adapter.files["output/report.md"] = "<!-- source: other/report.pdf -->\nother content";
      const vault = makeVault(adapter);
      await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "my content", vault, "output");
      expect(adapter.write).toHaveBeenCalledWith(
        "output/docs__report.md",
        "<!-- source: docs/report.pdf -->\nmy content"
      );
    });

    it("writes nothing when the path-derived name is also taken by a different source", async () => {
      const adapter = makeVaultAdapter();
      adapter.files["output/report.md"] = "<!-- source: other/report.pdf -->\nother";
      adapter.files["output/docs__report.md"] =
        "<!-- source: yet-another/docs__report.pdf -->\nyet another";
      const vault = makeVault(adapter);
      await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "my content", vault, "output");
      expect(adapter.write).not.toHaveBeenCalled();
    });

    it("derives distinct names for a/b/x.pdf and a_b/x.pdf", async () => {
      const adapter1 = makeVaultAdapter();
      adapter1.files["output/x.md"] = "<!-- source: other/x.pdf -->\nother";
      const vault1 = makeVault(adapter1);
      await saveConvertedDocOutput(makeTFile("a/b/x.pdf"), "content1", vault1, "output");

      const adapter2 = makeVaultAdapter();
      adapter2.files["output/x.md"] = "<!-- source: other/x.pdf -->\nother";
      const vault2 = makeVault(adapter2);
      await saveConvertedDocOutput(makeTFile("a_b/x.pdf"), "content2", vault2, "output");

      const path1 = adapter1.write.mock.calls[0][0];
      const path2 = adapter2.write.mock.calls[0][0];
      expect(path1).toBe("output/a__b__x.md");
      expect(path2).toBe("output/a_b__x.md");
      expect(path1).not.toBe(path2);
    });
  });
});
