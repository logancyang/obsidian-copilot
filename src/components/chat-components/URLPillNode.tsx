import React from "react";
import {
  $getRoot,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
} from "lexical";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BasePillNode } from "./BasePillNode";

export interface SerializedURLPillNode extends SerializedLexicalNode {
  url: string;
  title?: string;
  isActive?: boolean;
}

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
    super(key);
    this.__url = url;
    this.__title = title;
    this.__isActive = isActive;
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

  setActive(isActive: boolean): void {
    const writable = this.getWritable();
    writable.__isActive = isActive;
  }

  getActive(): boolean {
    return this.__isActive;
  }

  getURL(): string {
    return this.__url;
  }

  getTitle(): string | undefined {
    return this.__title;
  }

  decorate(): JSX.Element {
    return <URLPillComponent node={this} />;
  }
}

function convertURLPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const url = domNode.getAttribute("data-url");
  const title = domNode.getAttribute("data-title");
  if (url) {
    const node = $createURLPillNode(url, title || undefined);
    return { node };
  }
  return null;
}

export function $createURLPillNode(url: string, title?: string, isActive = false): URLPillNode {
  return new URLPillNode(url, title, isActive);
}

export function $isURLPillNode(node: LexicalNode | null | undefined): node is URLPillNode {
  return node instanceof URLPillNode;
}

interface URLPillComponentProps {
  node: URLPillNode;
}

function URLPillComponent({ node }: URLPillComponentProps): JSX.Element {
  const url = node.getURL();
  const isActive = node.getActive();

  return (
    <Badge
      variant="secondary"
      className={cn("tw-mx-0.5 tw-items-center tw-px-2 tw-py-0 tw-text-xs")}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <span className="tw-max-w-40 tw-truncate">{url}</span>
        {isActive && <span className="tw-text-xs tw-text-faint">Current</span>}
      </div>
    </Badge>
  );
}

/**
 * Plugin to register URLPillNode with the editor.
 * Deletion logic is handled by the centralized PillDeletionPlugin.
 */
export function URLPillPlugin(): null {
  // This plugin only handles node registration
  // All deletion logic is handled by the centralized PillDeletionPlugin
  return null;
}

// Add a utility function to remove pills by URL
export function $removePillsByURL(url: string): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: any): void {
    if ($isURLPillNode(node) && node.getURL() === url) {
      node.remove();
      removedCount++;
    } else if (typeof node.getChildren === "function") {
      const children = node.getChildren();
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return removedCount;
}
