import { extractMarkdownImagePaths } from "./imageExtraction";

describe("imageExtraction", () => {
  describe("extractMarkdownImagePaths()", () => {
    it("returns the destination of a simple image", () => {
      expect(extractMarkdownImagePaths("![](simple.png)")).toEqual(["simple.png"]);
    });

    it("returns every image in document order, whether on one line or split by text", () => {
      expect(extractMarkdownImagePaths("Images: ![](a.png) ![](b.png) ![](c.png)")).toEqual([
        "a.png",
        "b.png",
        "c.png",
      ]);
      expect(
        extractMarkdownImagePaths("First ![](a.png) then ![](b.png) and finally ![](c.png)")
      ).toEqual(["a.png", "b.png", "c.png"]);
    });

    it("returns an empty list when the text has no images", () => {
      expect(extractMarkdownImagePaths("no images here")).toEqual([]);
    });

    it("returns external URLs, including long query strings, untouched", () => {
      const url =
        "https://images.unsplash.com/photo-1746555697990-3a405a5152b9?q=80&w=1587&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

      expect(extractMarkdownImagePaths(`Unsplash image ![](${url})`)).toEqual([url]);
    });

    it("keeps relative and absolute local path prefixes for the caller to resolve", () => {
      expect(extractMarkdownImagePaths("![](./images/test.png) ![](../assets/icon.svg)")).toEqual([
        "./images/test.png",
        "../assets/icon.svg",
      ]);
    });

    it("keeps any file extension, leaving validation to the caller", () => {
      expect(extractMarkdownImagePaths("![](document.pdf) ![](notes.md)")).toEqual([
        "document.pdf",
        "notes.md",
      ]);
    });

    it("ignores wiki-style embeds", () => {
      expect(extractMarkdownImagePaths("![[wiki.png]] and ![](markdown.jpg)")).toEqual([
        "markdown.jpg",
      ]);
    });

    it("keeps balanced parentheses in the path", () => {
      expect(extractMarkdownImagePaths("![](foo(bar).png)")).toEqual(["foo(bar).png"]);
      expect(extractMarkdownImagePaths("![](image(1)(2).png)")).toEqual(["image(1)(2).png"]);
      expect(extractMarkdownImagePaths("![](foo(bar))")).toEqual(["foo(bar)"]);
      expect(
        extractMarkdownImagePaths("![Mars](https://en.wikipedia.org/wiki/Mars_(planet).jpg)")
      ).toEqual(["https://en.wikipedia.org/wiki/Mars_(planet).jpg"]);
    });

    it("keeps spaces in the path", () => {
      expect(extractMarkdownImagePaths("![](foo bar.png)")).toEqual(["foo bar.png"]);
      expect(extractMarkdownImagePaths("![](my folder/image - copy (1).png)")).toEqual([
        "my folder/image - copy (1).png",
      ]);
    });

    it("trims whitespace around the destination", () => {
      expect(extractMarkdownImagePaths("![](  image.png  )")).toEqual(["image.png"]);
    });

    it("accepts whitespace or a newline between the alt text and the destination", () => {
      expect(extractMarkdownImagePaths("![alt]\n(image.png)")).toEqual(["image.png"]);
    });

    it("keeps backslash escapes in the path as written", () => {
      expect(extractMarkdownImagePaths("![](path\\(1\\).png)")).toEqual(["path\\(1\\).png"]);
    });

    it("ignores parenthetical text that follows an image", () => {
      expect(extractMarkdownImagePaths("Image ![](a.png) (this is a note) more text")).toEqual([
        "a.png",
      ]);
    });

    it.each([
      ["parentheses", "![a (b)](img.png)"],
      ["brackets", "![alt [text]](img.png)"],
      ["parentheses and brackets", "![Figure 1 (a): Test [ref]](img.png)"],
    ])("finds the destination when the alt text contains %s", (_label, markdown) => {
      expect(extractMarkdownImagePaths(markdown)).toEqual(["img.png"]);
    });

    it("uses the outer destination when the alt text contains a nested link", () => {
      expect(extractMarkdownImagePaths("![a [b](inner.png)](outer.png)")).toEqual(["outer.png"]);
    });

    describe("angle-bracket destinations", () => {
      it("keeps spaces and parentheses inside the brackets", () => {
        expect(extractMarkdownImagePaths("![alt](<path with spaces.png>)")).toEqual([
          "path with spaces.png",
        ]);
        expect(extractMarkdownImagePaths("![](<image (1).png>)")).toEqual(["image (1).png"]);
        expect(
          extractMarkdownImagePaths("![Mars](<https://en.wikipedia.org/wiki/Mars_(planet).jpg>)")
        ).toEqual(["https://en.wikipedia.org/wiki/Mars_(planet).jpg"]);
      });

      it("returns several bracketed destinations from one document", () => {
        const markdown = `
          First ![img1](<https://example.com/image(1).png>)
          Second ![img2](<https://example.com/image (2).jpg>)
        `;

        expect(extractMarkdownImagePaths(markdown)).toEqual([
          "https://example.com/image(1).png",
          "https://example.com/image (2).jpg",
        ]);
      });

      it("trims whitespace inside the brackets", () => {
        expect(extractMarkdownImagePaths("![](< image.png >)")).toEqual(["image.png"]);
      });

      it("skips a destination whose angle bracket is never closed", () => {
        expect(extractMarkdownImagePaths("![](<foo bar.png)")).toEqual([]);
      });
    });

    describe("titles", () => {
      it.each([
        ["double-quoted", '![alt](image.png "title")'],
        ["single-quoted", "![alt](image.png 'title')"],
        ["parenthesized", "![alt](image.png (title))"],
      ])("drops a %s title", (_label, markdown) => {
        expect(extractMarkdownImagePaths(markdown)).toEqual(["image.png"]);
      });

      it("drops a title after an angle-bracket destination", () => {
        expect(
          extractMarkdownImagePaths('![alt](<https://example.com/image(1).png> "Title here")')
        ).toEqual(["https://example.com/image(1).png"]);
      });

      it("keeps parentheses in the path when a title follows", () => {
        expect(extractMarkdownImagePaths('![](foo(bar).png "title")')).toEqual(["foo(bar).png"]);
        expect(extractMarkdownImagePaths("![](foo(bar).png (title))")).toEqual(["foo(bar).png"]);
      });

      it("keeps spaces in the path when a title follows", () => {
        expect(extractMarkdownImagePaths('![](foo bar.png "title")')).toEqual(["foo bar.png"]);
        expect(extractMarkdownImagePaths("![](foo bar.png (title))")).toEqual(["foo bar.png"]);
      });

      it("reads a trailing space-separated parenthesized group as a title, not part of the path", () => {
        expect(extractMarkdownImagePaths("![](image (1))")).toEqual(["image"]);
      });
    });

    describe("malformed images", () => {
      it("skips an image with an empty destination", () => {
        expect(extractMarkdownImagePaths("![]()")).toEqual([]);
        expect(extractMarkdownImagePaths("![alt](<>)")).toEqual([]);
      });

      it("skips an image whose parenthesis is never closed", () => {
        expect(extractMarkdownImagePaths("![](foo(bar)")).toEqual([]);
      });

      it("still finds valid images around malformed ones", () => {
        const markdown = `
          Valid: ![](https://example.com/valid.png)
          Missing close paren: ![alt](https://example.com/missing.png
          Empty angle brackets: ![alt](<>)
        `;

        expect(extractMarkdownImagePaths(markdown)).toEqual(["https://example.com/valid.png"]);
      });
    });
  });
});
