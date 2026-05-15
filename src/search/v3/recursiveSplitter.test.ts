import { RecursiveCharacterTextSplitter as UpstreamSplitter } from "@langchain/textsplitters";
import { RecursiveCharacterTextSplitter } from "./recursiveSplitter";

// The only call site uses these separators with keepSeparator=false and overlap=0.
const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

async function upstream(text: string, chunkSize: number, chunkOverlap = 0): Promise<string[]> {
  const splitter = new UpstreamSplitter({
    chunkSize,
    chunkOverlap,
    separators: SEPARATORS,
    keepSeparator: false,
  });
  return splitter.splitText(text);
}

function ours(text: string, chunkSize: number, chunkOverlap = 0): string[] {
  return new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: SEPARATORS,
  }).splitText(text);
}

describe("RecursiveCharacterTextSplitter parity with @langchain/textsplitters", () => {
  it.each([
    ["empty", "", 100],
    ["short, no separator hit", "hello world", 100],
    ["splits on paragraphs", "para one\n\npara two\n\npara three", 15],
    ["recurses to single newlines", "line1\nline2\nline3\nline4\nline5", 12],
    ["falls through to sentences", "First. Second. Third sentence. Fourth.", 18],
    ["falls through to spaces", "alpha beta gamma delta epsilon zeta", 12],
    ["falls through to chars (no spaces)", "abcdefghijklmnopqrstuvwxyz", 5],
    [
      "mixed prose",
      "# Heading\n\nFirst paragraph with several words.\nSecond line.\n\nNew paragraph here.",
      20,
    ],
    ["trailing separator", "line one\nline two\n", 12],
    ["empty pieces between separators", "a\n\n\n\nb", 5],
  ])("matches upstream output: %s", async (_label, text, chunkSize) => {
    expect(ours(text, chunkSize)).toEqual(await upstream(text, chunkSize));
  });

  it("matches upstream with non-zero overlap", async () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu";
    expect(ours(text, 20, 5)).toEqual(await upstream(text, 20, 5));
  });

  it("createDocuments prepends chunkHeader on every chunk", async () => {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 15,
      chunkOverlap: 0,
      separators: SEPARATORS,
    });
    const docs = await splitter.createDocuments(["alpha beta gamma delta epsilon"], [], {
      chunkHeader: ">> ",
    });
    for (const doc of docs) {
      expect(doc.pageContent.startsWith(">> ")).toBe(true);
    }
  });
});
