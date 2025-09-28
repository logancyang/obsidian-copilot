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
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { PillBadge } from "./PillBadge";

export interface SerializedURLPillNode extends SerializedBasePillNode {
  url: string;
  title?: string;
  isActive?: boolean;
}

/**
 * URL pill node with special handling for titles and active state.
 * Uses a custom implementation due to additional complexity.
 */
export class URLPillNode extends BasePillNode {
  __url: string;
  __title?: string;
  __isActive: boolean;

  static getType(): string {
    return "url-pill";
  }

  static clone(node: URLPillNode): URLPillNode {
    return new URLPillNode(node.__url, node.__title, node.__isActive, node.__key);
  }

  constructor(url: string, title?: string, isActive = false, key?: NodeKey) {
    super(url, key);
    this.__url = url;
    this.__title = title;
    this.__isActive = isActive;
  }

  getClassName(): string {
    return "url-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-url-pill";
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "url-pill-wrapper";
    return span;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-url-pill")) {
          return {
            conversion: convertURLPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedURLPillNode): URLPillNode {
    const { url, title, isActive } = serializedNode;
    return $createURLPillNode(url, title, isActive);
  }

  exportJSON(): SerializedURLPillNode {
    return {
      ...super.exportJSON(),
      url: this.__url,
      title: this.__title,
      isActive: this.__isActive,
      type: "url-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-url-pill", "true");
    element.setAttribute("data-url", this.__url);
    if (this.__title) {
      element.setAttribute("data-title", this.__title);
    }
    element.textContent = this.__url;
    return { element };
  }

  getTextContent(): string {
    return this.__url;
  }

  getURL(): string {
    return this.__url;
  }

  setURL(url: string): void {
    const writable = this.getWritable();
    writable.__url = url;
  }

  getTitle(): string | undefined {
    return this.__title;
  }

  setTitle(title: string | undefined): void {
    const writable = this.getWritable();
    writable.__title = title;
  }

  setActive(isActive: boolean): void {
    const writable = this.getWritable();
    writable.__isActive = isActive;
  }

  getActive(): boolean {
    return this.__isActive;
  }

  decorate(): JSX.Element {
    const displayText = this.__title || this.__url;

    return (
      <PillBadge className="tw-whitespace-nowrap">
        <div className="tw-flex tw-items-center tw-gap-1">
          <span className="tw-max-w-40 tw-truncate">{displayText}</span>
          {this.__isActive && <span className="tw-text-xs tw-text-faint">Active</span>}
        </div>
      </PillBadge>
    );
  }
}

function convertURLPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const url = domNode.getAttribute("data-url");
  const title = domNode.getAttribute("data-title");
  if (url !== null) {
    const node = $createURLPillNode(url, title || undefined);
    return { node };
  }
  return null;
}

// Utility functions
export function $createURLPillNode(url: string, title?: string, isActive = false): URLPillNode {
  return new URLPillNode(url, title, isActive);
}

export function $findURLPills(): URLPillNode[] {
  const root = $getRoot();
  const pills: URLPillNode[] = [];

  function traverse(node: LexicalNode) {
    if (node instanceof URLPillNode) {
      pills.push(node);
    }

    if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = node.getChildren();
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return pills;
}

export function $removePillsByURL(url: string): void {
  const pills = $findURLPills();
  for (const pill of pills) {
    if (pill.getURL() === url) {
      pill.remove();
    }
  }
}

export function $isURLPillNode(node: any): node is URLPillNode {
  return node instanceof URLPillNode;
}
