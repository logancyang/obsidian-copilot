import { OBSIDIAN_PUBLISH_BASELINE } from "@/symposium/obsidianPublishBaseline";
import { SYMPOSIUM_MAX_HTML_BYTES } from "@/symposium/constants";
import { SymposiumDocument } from "@/symposium/types";
import { arrayBufferToBase64 } from "@/utils/base64";
import { App, Component, MarkdownRenderer, TFile } from "obsidian";

export { SYMPOSIUM_MAX_HTML_BYTES };

const PUBLISH_REMOVAL_SELECTOR = [
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "template",
  "textarea",
  "video",
  "audio",
  "applet",
  "dialog",
  "frame",
  "frameset",
  "fencedframe",
  "foreignObject",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  ".collapse-indicator",
  ".copy-code-button",
  ".edit-block-button",
  ".heading-collapse-indicator",
  ".markdown-embed-link",
  ".frontmatter",
  ".metadata-container",
].join(",");

const REVIEW_ACTIVE_CONTENT_SELECTOR = [
  "applet",
  "audio",
  "base",
  "button",
  "dialog",
  "embed",
  "fencedframe",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "link",
  "object",
  "portal",
  "script",
  "select",
  "template",
  "textarea",
  "video",
  "foreignObject",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "html[manifest]",
].join(",");

const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "formaction",
  "href",
  "manifest",
  "poster",
  "ping",
  "src",
  "xlink:href",
]);

const UNSAFE_REVIEW_ATTRIBUTES = new Set(["contenteditable", "ping", "srcdoc", "srcset"]);
const UNSAFE_REVIEW_CSS = /@import|url\s*\(|https?:|\/\/|\\|expression\s*\(|behavior\s*:/i;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const LOCAL_FRAGMENT_URL = /url\s*\(\s*(["']?)#[^\s)"']+\1\s*\)/gi;

const MIN_IMAGE_DATA_URL_PREFIX_BYTES = "data:image/png;base64,".length;
const IMAGE_DATA_URL_PLACEHOLDER = "data:image/png;base64,A";

type ModernRender = (
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
) => Promise<void>;

/**
 * Reports the measured or projected UTF-8 payload size when a document exceeds Symposium's limit.
 */
export class SymposiumDocumentTooLargeError extends Error {
  /**
   * @param byteLength The measured or projected serialized document size.
   */
  constructor(public readonly byteLength: number) {
    super(`Symposium HTML is ${byteLength} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`);
    this.name = "SymposiumDocumentTooLargeError";
    Object.setPrototypeOf(this, SymposiumDocumentTooLargeError.prototype);
  }
}

/** Reports that agent-finished HTML is not passive and self-contained. */
export class SymposiumDocumentUnsafeError extends Error {
  /**
   * @param issues The specific active or external constructs the author must remove.
   */
  constructor(issues: readonly string[]) {
    const visibleIssues = issues.slice(0, 8);
    const remainder = issues.length - visibleIssues.length;
    super(
      `Symposium HTML is not publishable: ${visibleIssues.join("; ")}${remainder > 0 ? `; plus ${remainder} more` : ""}.`
    );
    this.name = "SymposiumDocumentUnsafeError";
    Object.setPrototypeOf(this, SymposiumDocumentUnsafeError.prototype);
  }
}

/**
 * Captures one exact HTML string as the immutable payload reviewed and sent to Symposium.
 *
 * @param title The title sent alongside the HTML payload.
 * @param html The complete HTML bytes represented as a JavaScript string.
 */
export function createSymposiumDocument(title: string, html: string): SymposiumDocument {
  const byteLength = new TextEncoder().encode(html).byteLength;
  if (byteLength > SYMPOSIUM_MAX_HTML_BYTES) {
    throw new SymposiumDocumentTooLargeError(byteLength);
  }
  return Object.freeze({ title, html, byteLength });
}

/**
 * Captures agent-finished HTML only when host validation proves it passive and self-contained.
 *
 * @param title The title shown during review and sent with the payload.
 * @param html The complete HTML bytes staged by the agent.
 */
export function createSymposiumReviewDocument(title: string, html: string): SymposiumDocument {
  const document = createSymposiumDocument(title, html);
  validateSymposiumReviewHtml(html);
  return document;
}

/**
 * Reports every bounded, actionable violation found in one agent-staged document.
 *
 * @param html The complete staged HTML that must remain passive and self-contained.
 */
export function validateSymposiumReviewHtml(html: string): void {
  const document = new DOMParser().parseFromString(html, "text/html");
  const issues = new Set<string>();

  for (const activeElement of document.querySelectorAll(REVIEW_ACTIVE_CONTENT_SELECTOR)) {
    issues.add(`remove unsupported <${activeElement.localName}>`);
  }

  const redirects = [...document.querySelectorAll<HTMLMetaElement>("meta[http-equiv]")].some(
    (meta) => meta.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh"
  );
  if (redirects) {
    issues.add("remove the automatic redirect");
  }

  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    if (element.localName === "style" && hasUnsafeReviewCss(element.textContent ?? "")) {
      issues.add("embed or remove the external CSS resource in <style>");
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || UNSAFE_REVIEW_ATTRIBUTES.has(name)) {
        issues.add(`remove "${attribute.name}" from <${element.localName}>`);
        continue;
      }
      if (
        (name === "style" || attribute.value.toLowerCase().includes("url(")) &&
        hasUnsafeReviewCss(attribute.value)
      ) {
        issues.add(
          `embed or remove the external CSS resource in "${attribute.name}" on <${element.localName}>`
        );
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && !isAllowedReviewUrl(element, name, attribute.value)) {
        issues.add(`embed or remove "${attribute.name}" on <${element.localName}>`);
      }
    }
  }

  if (issues.size > 0) {
    throw new SymposiumDocumentUnsafeError([...issues]);
  }
}

function hasUnsafeReviewCss(css: string): boolean {
  const staticCss = css.replace(CSS_COMMENT, "").replace(LOCAL_FRAGMENT_URL, "");
  return UNSAFE_REVIEW_CSS.test(staticCss);
}

function isAllowedReviewUrl(element: Element, attribute: string, rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) {
    return false;
  }
  if (value.startsWith("#")) {
    return true;
  }

  const localName = element.localName.toLowerCase();
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (localName === "a" && attribute === "href") {
    return (
      value.startsWith("//") ||
      scheme === "http" ||
      scheme === "https" ||
      scheme === "mailto" ||
      scheme === "tel"
    );
  }
  if (localName === "img" && attribute === "src") {
    return isEmbeddedImageSource(value) && !/^data:image\/svg\+xml/i.test(value);
  }
  if (localName === "image" && (attribute === "href" || attribute === "xlink:href")) {
    return isEmbeddedImageSource(value) && !/^data:image\/svg\+xml/i.test(value);
  }
  if (attribute === "cite") {
    return value.startsWith("//") || scheme === "http" || scheme === "https";
  }
  return false;
}

/**
 * Builds the exact HTML payload sent to Symposium from Obsidian's settled reading-view DOM.
 *
 * @param app The Obsidian application that owns the source vault and renderer.
 * @param file The Markdown file whose current vault contents should be published.
 * @param component The lifecycle owner used by Obsidian's renderer and postprocessors.
 * @param ownerDocument The window-specific document in which the detached render tree is built.
 */
export async function buildSymposiumDocument(
  app: App,
  file: TFile,
  component: Component,
  ownerDocument: Document
): Promise<SymposiumDocument> {
  const markdown = await app.vault.read(file);
  const article = ownerDocument.win.createEl(
    "article",
    "markdown-preview-view markdown-rendered symposium-document"
  );

  const render = (MarkdownRenderer as unknown as { render: ModernRender }).render;
  await render(app, markdown, article, file.path, component);

  normalizeMath(article);
  normalizeTaskCheckboxes(article);
  removeUnsupportedContent(article);
  normalizeInternalLinks(article);
  const budgetArticle = article.cloneNode(true) as HTMLElement;
  sanitizeAttributes(budgetArticle);
  const projectedByteLength = new TextEncoder().encode(
    serializeDocument(ownerDocument, file.basename, budgetArticle)
  ).byteLength;
  if (projectedByteLength > SYMPOSIUM_MAX_HTML_BYTES) {
    throw new SymposiumDocumentTooLargeError(projectedByteLength);
  }
  await embedVaultImages(article, app, file.path, projectedByteLength);
  sanitizeAttributes(article);

  const title = file.basename;
  const html = serializeDocument(ownerDocument, title, article);
  return createSymposiumDocument(title, html);
}

function normalizeMath(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("mjx-container").forEach((container) => {
    const math = container.querySelector("mjx-assistive-mml math");
    if (math) {
      container.replaceWith(math.cloneNode(true));
    }
  });
}

function normalizeTaskCheckboxes(root: HTMLElement): void {
  root.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox").forEach((checkbox) => {
    const checked = checkbox.checked || checkbox.hasAttribute("checked");
    const marker = root.doc.win.createSpan({
      cls: "symposium-task-marker",
      text: checked ? "☑" : "☐",
      attr: { role: "img", "aria-label": checked ? "Completed task" : "Open task" },
    });
    checkbox.replaceWith(marker);
  });
}

function removeUnsupportedContent(root: HTMLElement): void {
  root.querySelectorAll(PUBLISH_REMOVAL_SELECTOR).forEach((element) => element.remove());
}

function normalizeInternalLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((link) => {
    const replacement = root.doc.win.createSpan(
      [...link.classList].filter((name) => name !== "is-unresolved").join(" ")
    );
    if (!replacement.classList.contains("internal-link")) {
      replacement.classList.add("internal-link");
    }
    if (link.title) {
      replacement.title = link.title;
    }
    replacement.append(...link.childNodes);
    link.replaceWith(replacement);
  });
}

async function embedVaultImages(
  root: HTMLElement,
  app: App,
  sourcePath: string,
  initialDocumentByteLength: number
): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>("img")].filter((image) => {
    const source = image.getAttribute("src")?.trim() ?? "";
    return !isRemoteImageSource(source) && !isEmbeddedImageSource(source);
  });
  if (images.length === 0) {
    return;
  }
  const lookup = buildVaultFileLookup(app);
  let projectedDocumentByteLength = initialDocumentByteLength;
  for (const image of images) {
    const source = image.getAttribute("src")?.trim() ?? "";
    const originalImageByteLength = sanitizedElementByteLength(image);
    const file = resolveVaultImage(image, app, sourcePath, lookup);
    if (!file) {
      const replacement = replaceMissingImage(image, source);
      projectedDocumentByteLength +=
        sanitizedElementByteLength(replacement) - originalImageByteLength;
      continue;
    }

    const projectedDataUrlByteLength =
      MIN_IMAGE_DATA_URL_PREFIX_BYTES + 4 * Math.ceil(file.stat.size / 3);
    const projectedImageByteLength = embeddedImageByteLength(image, projectedDataUrlByteLength);
    const projectedByteLength =
      projectedDocumentByteLength - originalImageByteLength + projectedImageByteLength;
    if (projectedByteLength > SYMPOSIUM_MAX_HTML_BYTES) {
      throw new SymposiumDocumentTooLargeError(projectedByteLength);
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await app.vault.readBinary(file);
    } catch {
      const replacement = replaceMissingImage(image, file.path);
      projectedDocumentByteLength +=
        sanitizedElementByteLength(replacement) - originalImageByteLength;
      continue;
    }

    const mimeType = detectImageMimeType(bytes);
    if (!mimeType) {
      const replacement = replaceMissingImage(image, file.path);
      projectedDocumentByteLength +=
        sanitizedElementByteLength(replacement) - originalImageByteLength;
      continue;
    }

    const dataUrlPrefix = `data:${mimeType};base64,`;
    const dataUrlByteLength = dataUrlPrefix.length + 4 * Math.ceil(bytes.byteLength / 3);
    const embeddedImageMarkupByteLength = embeddedImageByteLength(image, dataUrlByteLength);
    const embeddedDocumentByteLength =
      projectedDocumentByteLength - originalImageByteLength + embeddedImageMarkupByteLength;
    if (embeddedDocumentByteLength > SYMPOSIUM_MAX_HTML_BYTES) {
      throw new SymposiumDocumentTooLargeError(embeddedDocumentByteLength);
    }
    image.src = `${dataUrlPrefix}${arrayBufferToBase64(bytes)}`;
    image.removeAttribute("data-path");
    image.removeAttribute("data-src");
    projectedDocumentByteLength = embeddedDocumentByteLength;
  }
}

function sanitizedElementByteLength(element: HTMLElement): number {
  const clone = element.cloneNode(true) as HTMLElement;
  sanitizeAttributes(clone);
  return new TextEncoder().encode(clone.outerHTML).byteLength;
}

function embeddedImageByteLength(image: HTMLImageElement, dataUrlByteLength: number): number {
  const clone = image.cloneNode(true) as HTMLImageElement;
  clone.src = IMAGE_DATA_URL_PLACEHOLDER;
  clone.removeAttribute("data-path");
  clone.removeAttribute("data-src");
  return sanitizedElementByteLength(clone) - IMAGE_DATA_URL_PLACEHOLDER.length + dataUrlByteLength;
}

function buildVaultFileLookup(app: App): Map<string, TFile> {
  const byResourceUrl = new Map<string, TFile>();
  for (const file of app.vault.getFiles()) {
    byResourceUrl.set(app.vault.getResourcePath(file), file);
  }
  return byResourceUrl;
}

function resolveVaultImage(
  image: HTMLImageElement,
  app: App,
  sourcePath: string,
  lookup: Map<string, TFile>
): TFile | null {
  const references = [
    image.getAttribute("data-path"),
    image.getAttribute("data-src"),
    image.getAttribute("src"),
  ];

  for (const reference of references) {
    if (!reference) {
      continue;
    }

    const resourceFile = lookup.get(reference);
    if (resourceFile) {
      return resourceFile;
    }

    const decoded = decodeUrlComponent(reference);
    if (hasUrlScheme(decoded)) {
      continue;
    }
    const linkPath = decoded.replace(/^\/+/, "").split(/[?#]/, 1)[0];
    const resolved = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (resolved) {
      return resolved;
    }
    const direct = app.vault.getAbstractFileByPath(linkPath);
    if (isTFile(direct)) {
      return direct;
    }
  }

  return null;
}

function isTFile(value: unknown): value is TFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<TFile>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.basename === "string" &&
    typeof candidate.extension === "string"
  );
}

function detectImageMimeType(bytes: ArrayBuffer): string | null {
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 512));
  if (startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWithBytes(header, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWithAscii(header, "GIF87a") || startsWithAscii(header, "GIF89a")) {
    return "image/gif";
  }
  if (startsWithAscii(header, "BM")) {
    return "image/bmp";
  }
  if (startsWithAscii(header, "RIFF") && asciiAt(header, 8, "WEBP")) {
    return "image/webp";
  }
  if (startsWithBytes(header, [0x00, 0x00, 0x01, 0x00])) {
    return "image/x-icon";
  }
  if (
    startsWithBytes(header, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWithBytes(header, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "image/tiff";
  }
  if (hasIsoMediaBrand(header, ["avif", "avis"])) {
    return "image/avif";
  }
  if (hasIsoMediaBrand(header, ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"])) {
    return "image/heic";
  }
  if (hasIsoMediaBrand(header, ["mif1", "msf1"])) {
    return "image/heif";
  }

  const textHeader = new TextDecoder().decode(header).trimStart();
  if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(textHeader)) {
    return "image/svg+xml";
  }

  return null;
}

function hasIsoMediaBrand(bytes: Uint8Array, brands: readonly string[]): boolean {
  if (!asciiAt(bytes, 4, "ftyp")) {
    return false;
  }
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  if (boxSize < 16) {
    return false;
  }
  const boxEnd = Math.min(boxSize, bytes.byteLength);
  if (brands.some((brand) => asciiAt(bytes, 8, brand))) {
    return true;
  }
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    if (brands.some((brand) => asciiAt(bytes, offset, brand))) {
      return true;
    }
  }
  return false;
}

function startsWithBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, expected: string): boolean {
  return asciiAt(bytes, 0, expected);
}

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.byteLength < offset + expected.length) {
    return false;
  }
  return [...expected].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0)
  );
}

function replaceMissingImage(image: HTMLImageElement, source: string): HTMLElement {
  const replacement = image.doc.win.createSpan({
    cls: "symposium-missing-asset",
    text: `[Missing image: ${image.alt || source || "unknown"}]`,
  });
  image.replaceWith(replacement);
  return replacement;
}

function sanitizeAttributes(root: HTMLElement): void {
  for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        name === "srcset" ||
        name === "contenteditable" ||
        name === "referrerpolicy"
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && !isAllowedUrl(element, name, attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element.tagName === "A" && element.hasAttribute("target")) {
      element.setAttribute("rel", "noopener noreferrer");
    }
    if (
      element.tagName === "IMG" &&
      isRemoteImageSource(element.getAttribute("src")?.trim() ?? "")
    ) {
      element.setAttribute("referrerpolicy", "no-referrer");
    }
  }
}

function isAllowedUrl(element: HTMLElement, attribute: string, rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) {
    return false;
  }
  if (value.startsWith("#")) {
    return true;
  }
  if (value.startsWith("//")) {
    return (
      (element.tagName === "A" && attribute === "href") ||
      (element.tagName === "IMG" && attribute === "src")
    );
  }

  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (element.tagName === "IMG" && attribute === "src") {
    return scheme === "http" || scheme === "https" || isEmbeddedImageSource(value);
  }
  if (element.tagName === "A" && attribute === "href") {
    return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel";
  }
  if (attribute === "cite") {
    return scheme === "http" || scheme === "https";
  }
  return false;
}

function isRemoteImageSource(source: string): boolean {
  return /^(?:https?:)?\/\//i.test(source);
}

function isEmbeddedImageSource(source: string): boolean {
  return /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=\s]+$/i.test(source);
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function serializeDocument(ownerDocument: Document, title: string, article: HTMLElement): string {
  const titleElement = ownerDocument.win.createEl("title", { text: title });
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    titleElement.outerHTML,
    `<style id="symposium-obsidian-publish-baseline">${OBSIDIAN_PUBLISH_BASELINE}</style>`,
    "</head>",
    '<body><main class="publish-renderer">',
    article.outerHTML,
    "</main></body>",
    "</html>",
  ].join("");
}
