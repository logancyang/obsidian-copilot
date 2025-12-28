import React from "react";
import {
  $getRoot,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
} from "lexical";
import { Globe } from "lucide-react";
import { getDomainFromUrl } from "@/utils";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { PillBadge } from "./PillBadge";

export interface SerializedWebTabPillNode extends SerializedBasePillNode {
  url: string;
  title?: string;
  faviconUrl?: string;
}

/**
 * Format a web tab reference for text serialization.
 * Uses a simple bracket format with globe emoji to identify web tabs.
 * @param url - The web tab URL
 * @param title - Optional title of the web tab
 * @returns Formatted string: `[🌐 title]` if title exists, otherwise `[🌐 domain]`
 */
function formatWebTabPillTextContent(url: string, title?: string): string {
  const displayText = title?.trim() || getDomainFromUrl(url) || "Untitled";
  return `[🌐: ${displayText}]`;
}

/**
 * WebTabPillNode represents a web tab from Web Viewer in context.
 * Stores URL, title, and optional favicon URL.
 */
export class WebTabPillNode extends BasePillNode {
  __url: string;
  __title?: string;
  __faviconUrl?: string;

  static getType(): string {
    return "web-tab-pill";
  }

  static clone(node: WebTabPillNode): WebTabPillNode {
    return new WebTabPillNode(node.__url, node.__title, node.__faviconUrl, node.__key);
  }

  constructor(url: string, title?: string, faviconUrl?: string, key?: NodeKey) {
    super(url, key);
    this.__url = url;
    this.__title = title;
    this.__faviconUrl = faviconUrl;
  }

  getClassName(): string {
    return "web-tab-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-web-tab-pill";
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "web-tab-pill-wrapper";
    return span;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-web-tab-pill")) {
          return {
            conversion: convertWebTabPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedWebTabPillNode): WebTabPillNode {
    const { url, title, faviconUrl } = serializedNode;
    return $createWebTabPillNode(url, title, faviconUrl);
  }

  exportJSON(): SerializedWebTabPillNode {
    return {
      ...super.exportJSON(),
      url: this.__url,
      title: this.__title,
      faviconUrl: this.__faviconUrl,
      type: "web-tab-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-web-tab-pill", "true");
    element.setAttribute("data-url", this.__url);
    if (this.__title) {
      element.setAttribute("data-title", this.__title);
    }
    if (this.__faviconUrl) {
      element.setAttribute("data-favicon-url", this.__faviconUrl);
    }
    element.textContent = formatWebTabPillTextContent(this.__url, this.__title);
    return { element };
  }

  getTextContent(): string {
    return formatWebTabPillTextContent(this.__url, this.__title);
  }

  getURL(): string {
    return this.__url;
  }

  getTitle(): string | undefined {
    return this.__title;
  }

  getFaviconUrl(): string | undefined {
    return this.__faviconUrl;
  }

  /**
   * Set the title metadata for this web tab pill.
   * Must be called within a Lexical update context.
   */
  setTitle(title?: string): void {
    const writable = this.getWritable();
    writable.__title = title;
  }

  /**
   * Set the favicon URL metadata for this web tab pill.
   * Must be called within a Lexical update context.
   */
  setFaviconUrl(faviconUrl?: string): void {
    const writable = this.getWritable();
    writable.__faviconUrl = faviconUrl;
  }

  decorate(): JSX.Element {
    const displayText = this.__title || this.__url;

    return (
      <PillBadge className="tw-whitespace-nowrap">
        <div className="tw-flex tw-items-center tw-gap-1">
          <Globe className="tw-size-3" />
          <span className="tw-max-w-40 tw-truncate">{displayText}</span>
        </div>
      </PillBadge>
    );
  }
}

function convertWebTabPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const url = domNode.getAttribute("data-url");
  const title = domNode.getAttribute("data-title");
  const faviconUrl = domNode.getAttribute("data-favicon-url");
  if (url !== null) {
    const node = $createWebTabPillNode(url, title || undefined, faviconUrl || undefined);
    return { node };
  }
  return null;
}

/** Create a WebTabPillNode. */
export function $createWebTabPillNode(
  url: string,
  title?: string,
  faviconUrl?: string
): WebTabPillNode {
  return new WebTabPillNode(url, title, faviconUrl);
}

/** Check if a node is a WebTabPillNode. */
export function $isWebTabPillNode(node: LexicalNode | null | undefined): node is WebTabPillNode {
  return node instanceof WebTabPillNode;
}

/** Find all WebTabPillNodes in the editor. */
export function $findWebTabPills(): WebTabPillNode[] {
  const root = $getRoot();
  const pills: WebTabPillNode[] = [];

  function traverse(node: LexicalNode) {
    if (node instanceof WebTabPillNode) {
      pills.push(node);
    }
    if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = (node as { getChildren: () => LexicalNode[] }).getChildren();
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return pills;
}

/**
 * Check if a WebTabPillNode with the given URL exists in the editor.
 * Must be called within a Lexical read/update context.
 * Uses early-exit traversal for better performance.
 */
export function $hasWebTabPillWithUrl(url: string): boolean {
  const root = $getRoot();

  function traverse(node: LexicalNode): boolean {
    if (node instanceof WebTabPillNode && node.getURL() === url) {
      return true; // Early exit on match
    }
    if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = (node as { getChildren: () => LexicalNode[] }).getChildren();
      for (const child of children) {
        if (traverse(child)) {
          return true; // Propagate early exit
        }
      }
    }
    return false;
  }

  return traverse(root);
}

/** Remove WebTabPillNodes by URL. */
export function $removeWebTabPillsByUrl(url: string): void {
  const pills = $findWebTabPills();
  for (const pill of pills) {
    if (pill.getURL() === url) {
      pill.remove();
    }
  }
}
