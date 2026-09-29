import { extractMarkdownImagePaths } from "./imageExtraction";

describe("Image extraction from content", () => {
  const mockApp = {
    metadataCache: {
      getFirstLinkpathDest: jest.fn() as jest.Mock<{ path: string } | null, [string, string]>,
    },
  };

  (window as unknown as { app: typeof mockApp }).app = mockApp;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function extractEmbeddedImages(content: string, sourcePath?: string): Promise<string[]> {
    const wikiImageRegex = /!\[\[(.*?\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/g;

    const resolvedImages: string[] = [];

    const wikiMatches = [...content.matchAll(wikiImageRegex)];
    for (const match of wikiMatches) {
      const imageName = match[1];

      if (sourcePath) {
        const resolvedFile = mockApp.metadataCache.getFirstLinkpathDest(imageName, sourcePath);

        if (resolvedFile) {
          resolvedImages.push(resolvedFile.path);
        } else {
          resolvedImages.push(imageName);
        }
      } else {
        resolvedImages.push(imageName);
      }
    }

    const mdImagePaths = extractMarkdownImagePaths(content);
    for (const imagePath of mdImagePaths) {
      if (!imagePath) continue;

      if (imagePath.match(/^https?:\/\//)) {
        resolvedImages.push(imagePath);
        continue;
      }

      const cleanPath = imagePath.replace(/^\.\//, "").replace(/^\//, "");

      if (sourcePath) {
        const resolvedFile = mockApp.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);

        if (resolvedFile) {
          resolvedImages.push(resolvedFile.path);
        } else {
          resolvedImages.push(cleanPath);
        }
      } else {
        resolvedImages.push(cleanPath);
      }
    }

    return resolvedImages;
  }

  describe("Wiki-style image syntax ![[image]]", () => {
    it("should extract wiki-style images with extensions", async () => {
      const content = "Here is an image ![[screenshot.png]] and another ![[diagram.jpg]]";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce({ path: "attachments/screenshot.png" })
        .mockReturnValueOnce({ path: "images/diagram.jpg" });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["attachments/screenshot.png", "images/diagram.jpg"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "screenshot.png",
        sourcePath
      );
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "diagram.jpg",
        sourcePath
      );
    });

    it("should handle wiki-style images with paths", async () => {
      const content = "Image with path ![[folder/image.png]]";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValueOnce({
        path: "resolved/folder/image.png",
      });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["resolved/folder/image.png"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "folder/image.png",
        sourcePath
      );
    });

    it("should fallback to raw filename when file not found", async () => {
      const content = "Missing image ![[missing.png]]";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValueOnce(null);

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["missing.png"]);
    });
  });

  describe("Markdown image syntax ![](image)", () => {
    it("should extract markdown images with simple paths", async () => {
      const content = "Here is ![alt text](image.png) and ![](photo.jpg)";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce({ path: "attachments/image.png" })
        .mockReturnValueOnce({ path: "attachments/photo.jpg" });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["attachments/image.png", "attachments/photo.jpg"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "image.png",
        sourcePath
      );
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "photo.jpg",
        sourcePath
      );
    });

    it("should handle markdown images with relative paths", async () => {
      const content = "Relative paths ![](./images/test.png) and ![](../assets/icon.svg)";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce({ path: "images/test.png" })
        .mockReturnValueOnce({ path: "assets/icon.svg" });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["images/test.png", "assets/icon.svg"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "images/test.png",
        sourcePath
      );
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "../assets/icon.svg",
        sourcePath
      );
    });

    it("should include external URLs", async () => {
      const content =
        "External images ![](https://example.com/image.png) and ![](http://site.com/pic.jpg)";
      const sourcePath = "notes/test.md";

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["https://example.com/image.png", "http://site.com/pic.jpg"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("should include external URLs with query parameters", async () => {
      const content =
        "Unsplash image ![](https://images.unsplash.com/photo-1746555697990-3a405a5152b9?q=80&w=1587&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)";
      const sourcePath = "notes/test.md";

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual([
        "https://images.unsplash.com/photo-1746555697990-3a405a5152b9?q=80&w=1587&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      ]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("should clean leading slashes from paths", async () => {
      const content = "Absolute path ![](/images/absolute.png)";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValueOnce({
        path: "images/absolute.png",
      });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["images/absolute.png"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "images/absolute.png",
        sourcePath
      );
    });
  });

  describe("Mixed syntaxes", () => {
    it("should extract both wiki and markdown images", async () => {
      const content = "Wiki ![[wiki.png]] and markdown ![](markdown.jpg) together";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce({ path: "attachments/wiki.png" })
        .mockReturnValueOnce({ path: "attachments/markdown.jpg" });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["attachments/wiki.png", "attachments/markdown.jpg"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
    });

    it("should handle multiple images of both types", async () => {
      const content = `
        ![[first.png]] some text ![](second.jpg)
        More text ![[third.gif]] and ![alt](fourth.svg)
      `;
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce({ path: "imgs/first.png" })
        .mockReturnValueOnce({ path: "imgs/third.gif" })
        .mockReturnValueOnce({ path: "imgs/second.jpg" })
        .mockReturnValueOnce({ path: "imgs/fourth.svg" });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual([
        "imgs/first.png",
        "imgs/third.gif",
        "imgs/second.jpg",
        "imgs/fourth.svg",
      ]);
    });
  });

  describe("Edge cases", () => {
    it("should extract all markdown links regardless of extension", async () => {
      const content = "Valid ![[image.png]] but not ![[document.pdf]] or ![](script.js)";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce({ path: "attachments/image.png" })
        .mockReturnValueOnce(null);

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["attachments/image.png", "script.js"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
    });

    it("should handle content with no images", async () => {
      const content = "Just text with no images";
      const sourcePath = "notes/test.md";

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual([]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("should handle no source path", async () => {
      const content = "Image ![[test.png]] and ![](other.jpg)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["test.png", "other.jpg"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("should handle malformed markdown syntax", async () => {
      const content = "Malformed ![](no-extension) and ![]() empty";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValueOnce(null);

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["no-extension"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(1);
    });

    it("should include all markdown links for local paths (validation happens in ImageBatchProcessor)", async () => {
      const content = "Document ![](document.pdf) and text ![](notes.md)";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["document.pdf", "notes.md"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
    });

    it("should handle special characters in filenames", async () => {
      const content = "Special chars ![[image (1).png]] and ![](file-name_2.jpg)";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce({ path: "attachments/image (1).png" })
        .mockReturnValueOnce({ path: "attachments/file-name_2.jpg" });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["attachments/image (1).png", "attachments/file-name_2.jpg"]);
    });
  });

  describe("Angle bracket syntax ![alt](<url>)", () => {
    it("should extract URL with parentheses using angle brackets", async () => {
      const content = "Wikipedia link ![Mars](<https://en.wikipedia.org/wiki/Mars_(planet).jpg>)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["https://en.wikipedia.org/wiki/Mars_(planet).jpg"]);
    });

    it("should extract URL with spaces using angle brackets", async () => {
      const content = "Spaced path ![alt](<path/my image file.png>)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["path/my image file.png"]);
    });

    it("should extract multiple angle bracket URLs", async () => {
      const content = `
        First ![img1](<https://example.com/image(1).png>)
        Second ![img2](<https://example.com/image (2).jpg>)
      `;

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual([
        "https://example.com/image(1).png",
        "https://example.com/image (2).jpg",
      ]);
    });
  });

  describe('Image with title syntax ![alt](url "title")', () => {
    it("should extract URL with double-quoted title", async () => {
      const content = 'Image with title ![alt](https://example.com/img.png "This is the title")';

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["https://example.com/img.png"]);
    });

    it("should extract URL with single-quoted title", async () => {
      const content = "Image with title ![alt](https://example.com/img.png 'Single quoted title')";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["https://example.com/img.png"]);
    });

    it("should extract URL with parentheses title", async () => {
      const content = "Image with title ![alt](https://example.com/img.png (Parentheses title))";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["https://example.com/img.png"]);
    });

    it("should extract angle bracket URL with title", async () => {
      const content =
        'Angle bracket with title ![alt](<https://example.com/image(1).png> "Title here")';

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["https://example.com/image(1).png"]);
    });

    it("should handle local path with title", async () => {
      const content = 'Local image ![alt](images/photo.jpg "My photo")';
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValueOnce({
        path: "images/photo.jpg",
      });

      const result = await extractEmbeddedImages(content, sourcePath);

      expect(result).toEqual(["images/photo.jpg"]);
    });
  });

  describe("Mixed enhanced syntaxes", () => {
    it("should handle all syntax variations together", async () => {
      const content = `
        Standard: ![](https://example.com/standard.png)
        With title: ![alt](https://example.com/titled.png "Title")
        Angle bracket: ![alt](<https://example.com/path (special).png>)
        Angle with title: ![alt](<https://example.com/both(1).png> "Both features")
        Wiki style: ![[local.png]]
      `;

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual([
        "local.png",
        "https://example.com/standard.png",
        "https://example.com/titled.png",
        "https://example.com/path (special).png",
        "https://example.com/both(1).png",
      ]);
    });

    it("should not be confused by malformed syntax", async () => {
      const content = `
        Valid: ![](https://example.com/valid.png)
        Missing close bracket: ![alt](https://example.com/missing.png
        Empty angle brackets: ![alt](<>)
      `;

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["https://example.com/valid.png"]);
    });
  });

  describe("Paths with parentheses (balanced parentheses support)", () => {
    it("should extract path with single pair of parentheses", async () => {
      const content = "Image ![](foo(bar).png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["foo(bar).png"]);
    });

    it("should extract path with multiple pairs of parentheses", async () => {
      const content = "Image ![](image(1)(2).png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["image(1)(2).png"]);
    });

    it("should extract Wikipedia-style URL with parentheses", async () => {
      const content = "![Mars](https://en.wikipedia.org/wiki/Mars_(planet).jpg)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["https://en.wikipedia.org/wiki/Mars_(planet).jpg"]);
    });

    it("should extract local path with parentheses", async () => {
      const content = "![](images/screenshot (1).png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["images/screenshot (1).png"]);
    });
  });

  describe("Paths with spaces (space support)", () => {
    it("should extract path with spaces", async () => {
      const content = "Image ![](foo bar.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["foo bar.png"]);
    });

    it("should extract path with multiple spaces", async () => {
      const content = "Image ![](path/my image file.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["path/my image file.png"]);
    });

    it("should extract path with spaces and special chars", async () => {
      const content = "Image ![](my folder/image - copy (1).png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["my folder/image - copy (1).png"]);
    });
  });

  describe("Multiple images on same line", () => {
    it("should extract multiple images on same line", async () => {
      const content = "Images: ![](a.png) ![](b.png) ![](c.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["a.png", "b.png", "c.png"]);
    });

    it("should extract multiple images with text between", async () => {
      const content = "First ![](a.png) then ![](b.png) and finally ![](c.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["a.png", "b.png", "c.png"]);
    });

    it("should handle image followed by parenthetical text", async () => {
      const content = "Image ![](a.png) (this is a note) more text";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["a.png"]);
    });
  });

  describe("Alt text with special characters", () => {
    it("should handle alt text with parentheses", async () => {
      const content = "![a (b)](img.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["img.png"]);
    });

    it("should handle alt text with brackets", async () => {
      const content = "![alt [text]](img.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["img.png"]);
    });

    it("should handle complex alt text", async () => {
      const content = "![Figure 1 (a): Test [ref]](diagram.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["diagram.png"]);
    });
  });

  describe("Parser edge cases", () => {
    it("should handle escaped characters in path", async () => {
      const content = "![](path\\(1\\).png)";

      const result = await extractEmbeddedImages(content);

      expect(result.length).toBe(1);
    });

    it("should handle leading/trailing whitespace in path", async () => {
      const content = "![](  image.png  )";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["image.png"]);
    });

    it("should handle newline between ] and (", async () => {
      const content = "![alt]\n(image.png)";

      const result = await extractEmbeddedImages(content);

      expect(result).toEqual(["image.png"]);
    });
  });
});

describe("extractMarkdownImagePaths", () => {
  it("should extract simple paths", () => {
    const result = extractMarkdownImagePaths("![](simple.png)");
    expect(result).toEqual(["simple.png"]);
  });

  it("should extract paths with parentheses", () => {
    const result = extractMarkdownImagePaths("![](foo(bar).png)");
    expect(result).toEqual(["foo(bar).png"]);
  });

  it("should extract paths with spaces", () => {
    const result = extractMarkdownImagePaths("![](foo bar.png)");
    expect(result).toEqual(["foo bar.png"]);
  });

  it("should extract multiple images", () => {
    const result = extractMarkdownImagePaths("![](a.png) ![](b.png)");
    expect(result).toEqual(["a.png", "b.png"]);
  });

  it("should handle angle bracket syntax", () => {
    const result = extractMarkdownImagePaths("![alt](<path with spaces.png>)");
    expect(result).toEqual(["path with spaces.png"]);
  });

  it("should handle title syntax", () => {
    const result = extractMarkdownImagePaths('![alt](image.png "title")');
    expect(result).toEqual(["image.png"]);
  });

  it("should return empty array for no images", () => {
    const result = extractMarkdownImagePaths("no images here");
    expect(result).toEqual([]);
  });

  it("should skip empty paths", () => {
    const result = extractMarkdownImagePaths("![]()");
    expect(result).toEqual([]);
  });

  it("should trim inside angle destinations (bug fix)", () => {
    const result = extractMarkdownImagePaths("![](< image.png >)");
    expect(result).toEqual(["image.png"]);
  });

  it("should handle parentheses in path with double-quoted title", () => {
    const result = extractMarkdownImagePaths('![](foo(bar).png "title")');
    expect(result).toEqual(["foo(bar).png"]);
  });

  it("should handle parentheses in path with parentheses title", () => {
    const result = extractMarkdownImagePaths("![](foo(bar).png (title))");
    expect(result).toEqual(["foo(bar).png"]);
  });

  it("should handle spaces in path with double-quoted title", () => {
    const result = extractMarkdownImagePaths('![](foo bar.png "title")');
    expect(result).toEqual(["foo bar.png"]);
  });

  it("should handle spaces in path with parentheses title", () => {
    const result = extractMarkdownImagePaths("![](foo bar.png (title))");
    expect(result).toEqual(["foo bar.png"]);
  });

  it("should treat space + parentheses at end as title (ambiguous case)", () => {
    const result = extractMarkdownImagePaths("![](image (1))");
    expect(result).toEqual(["image"]);
  });

  it("should preserve parentheses in filename when using angle brackets", () => {
    const result = extractMarkdownImagePaths("![](<image (1).png>)");
    expect(result).toEqual(["image (1).png"]);
  });

  it("should skip unclosed parenthesis in destination", () => {
    const result = extractMarkdownImagePaths("![](foo(bar)");
    expect(result).toEqual([]);
  });

  it("should skip angle destination without closing bracket", () => {
    const result = extractMarkdownImagePaths("![](<foo bar.png)");
    expect(result).toEqual([]);
  });

  it("should handle nested link syntax in alt text (avoid old regex false positive)", () => {
    const result = extractMarkdownImagePaths("![a [b](inner.png)](outer.png)");
    expect(result).toEqual(["outer.png"]);
  });

  it("should handle balanced parentheses without truncation", () => {
    const result = extractMarkdownImagePaths("![](foo(bar))");
    expect(result).toEqual(["foo(bar)"]);
  });
});
