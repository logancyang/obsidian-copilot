import { TFile, Vault } from "obsidian";
import { saveConvertedDocOutput } from "./convertedDocOutput";

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
  return { path, basename, extension } as unknown as TFile;
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

describe("saveConvertedDocOutput", () => {
  it("no-ops when outputFolder is empty", async () => {
    const adapter = makeVaultAdapter();
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "content", vault, "");
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("no-ops when outputFolder is whitespace", async () => {
    const adapter = makeVaultAdapter();
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "content", vault, "   ");
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("no-ops when file is markdown", async () => {
    const adapter = makeVaultAdapter();
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("notes/note.md"), "content", vault, "output");
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("no-ops when content is empty", async () => {
    const adapter = makeVaultAdapter();
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "", vault, "output");
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("no-ops when content is an error string", async () => {
    const adapter = makeVaultAdapter();
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(
      makeTFile("docs/report.pdf"),
      "[Error: something failed]",
      vault,
      "output"
    );
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("writes {basename}.md with source header", async () => {
    const adapter = makeVaultAdapter();
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "parsed markdown", vault, "output");
    expect(adapter.write).toHaveBeenCalledWith(
      "output/report.md",
      "<!-- source: docs/report.pdf -->\nparsed markdown"
    );
  });

  it("skips write when existing file has identical content", async () => {
    const adapter = makeVaultAdapter();
    adapter.files["output/report.md"] = "<!-- source: docs/report.pdf -->\nparsed markdown";
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "parsed markdown", vault, "output");
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("overwrites when same source but content changed", async () => {
    const adapter = makeVaultAdapter();
    adapter.files["output/report.md"] = "<!-- source: docs/report.pdf -->\nold content";
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "new content", vault, "output");
    expect(adapter.write).toHaveBeenCalledWith(
      "output/report.md",
      "<!-- source: docs/report.pdf -->\nnew content"
    );
  });

  it("disambiguates with __ separator when basename collides with different source", async () => {
    const adapter = makeVaultAdapter();
    adapter.files["output/report.md"] = "<!-- source: other/report.pdf -->\nother content";
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "my content", vault, "output");
    expect(adapter.write).toHaveBeenCalledWith(
      "output/docs__report.md",
      "<!-- source: docs/report.pdf -->\nmy content"
    );
  });

  it("skips when disambiguated path also collides with different source", async () => {
    const adapter = makeVaultAdapter();
    adapter.files["output/report.md"] = "<!-- source: other/report.pdf -->\nother";
    adapter.files["output/docs__report.md"] =
      "<!-- source: yet-another/docs__report.pdf -->\nyet another";
    const vault = makeVault(adapter);
    await saveConvertedDocOutput(makeTFile("docs/report.pdf"), "my content", vault, "output");
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("__ separator distinguishes a/b/x.pdf from a_b/x.pdf", async () => {
    // a/b/x.pdf
    const adapter1 = makeVaultAdapter();
    adapter1.files["output/x.md"] = "<!-- source: other/x.pdf -->\nother";
    const vault1 = makeVault(adapter1);
    await saveConvertedDocOutput(makeTFile("a/b/x.pdf"), "content1", vault1, "output");

    // a_b/x.pdf
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
