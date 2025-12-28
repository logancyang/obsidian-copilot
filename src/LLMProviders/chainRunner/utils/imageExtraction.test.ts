// Test for the image extraction logic
describe("Image extraction from content", () => {
  // Mock the global app object
  const mockApp = {
    metadataCache: {
      getFirstLinkpathDest: jest.fn(),
    },
  };

  (global as any).app = mockApp;

  // Mock logger (removed since we're no longer logging warnings)

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper function that replicates the extractEmbeddedImages logic
  async function extractEmbeddedImages(content: string, sourcePath?: string): Promise<string[]> {
    // Match both wiki-style ![[image.ext]] and standard markdown ![alt](image.ext)
    const wikiImageRegex = /!\[\[(.*?\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/g;
    // Enhanced regex to handle markdown image syntax:
    // 1. Angle brackets: ![alt](<url with spaces or ()>) - captures in group 1
    // 2. Standard: ![alt](url) - captures in group 2
    // 3. Both support optional title: "title", 'title', or (title)
    const markdownImageRegex =
      /!\[.*?\]\((?:<([^>]+)>|([^\s)"'(<>]+))(?:\s+["'(][^"')]*["')])?\)/g;

    const resolvedImages: string[] = [];

    // Process wiki-style images
    const wikiMatches = [...content.matchAll(wikiImageRegex)];
    for (const match of wikiMatches) {
      const imageName = match[1];

      // If we have a source path and access to the app, resolve the wikilink
      if (sourcePath) {
        const resolvedFile = mockApp.metadataCache.getFirstLinkpathDest(imageName, sourcePath);

        if (resolvedFile) {
          // Use the resolved path
          resolvedImages.push(resolvedFile.path);
        } else {
          // If file not found, still include the raw filename
          resolvedImages.push(imageName);
        }
      } else {
        // Fallback to raw filename if no source path available
        resolvedImages.push(imageName);
      }
    }

    // Process standard markdown images
    const mdMatches = [...content.matchAll(markdownImageRegex)];
    for (const match of mdMatches) {
      // Group 1 is for angle bracket syntax, group 2 is for standard syntax
      const imagePath = (match[1] || match[2] || "").trim();

      // Skip empty paths
      if (!imagePath) continue;

      // Handle external URLs (http://, https://, etc.)
      if (imagePath.match(/^https?:\/\//)) {
        // Include external URLs - they will be processed by processImageUrls
        // The ImageProcessor will validate if it's actually an image
        resolvedImages.push(imagePath);
        continue;
      }

      // For local paths, resolve them using Obsidian's metadata cache
      // Let ImageBatchProcessor handle validation of whether it's actually an image
      // Clean up the path (remove any leading ./ or /)
      const cleanPath = imagePath.replace(/^\.\//, "").replace(/^\//, "");

      // If we have a source path and access to the app, resolve the path
      if (sourcePath) {
        const resolvedFile = mockApp.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);

        if (resolvedFile) {
          // Use the resolved path
          resolvedImages.push(resolvedFile.path);
        } else {
          // If file not found, still include the raw path
          // Let ImageBatchProcessor handle validation
          resolvedImages.push(cleanPath);
        }
      } else {
        // Fallback to raw path if no source path available
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
        .mockReturnValueOnce(null); // script.js not found

      const result = await extractEmbeddedImages(content, sourcePath);

      // Wiki-style ![[document.pdf]] is skipped because it doesn't have image extension
      // But markdown ![](script.js) is included - ImageBatchProcessor will validate
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

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValueOnce(null); // no-extension not found

      const result = await extractEmbeddedImages(content, sourcePath);

      // no-extension is included, empty path is skipped
      expect(result).toEqual(["no-extension"]);
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(1);
    });

    it("should include all markdown links for local paths (validation happens in ImageBatchProcessor)", async () => {
      const content = "Document ![](document.pdf) and text ![](notes.md)";
      const sourcePath = "notes/test.md";

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce(null) // document.pdf not found
        .mockReturnValueOnce(null); // notes.md not found

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

  describe("Image with title syntax ![alt](url \"title\")", () => {
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

      // Only the valid one should be extracted
      expect(result).toEqual(["https://example.com/valid.png"]);
    });
  });
});
