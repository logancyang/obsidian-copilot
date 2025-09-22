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

export interface SerializedTagPillNode extends SerializedLexicalNode {
  tagName: string;
}

export class TagPillNode extends BasePillNode {
  __tagName: string;

  static getType(): string {
    return "tag-pill";
  }

  static clone(node: TagPillNode): TagPillNode {
    return new TagPillNode(node.__tagName, node.__key);
  }

  constructor(tagName: string, key?: NodeKey) {
    super(key);
    this.__tagName = tagName;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "tag-pill-wrapper";
    return span;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-tag-pill")) {
          return {
            conversion: convertTagPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedTagPillNode): TagPillNode {
    const { tagName } = serializedNode;
    return $createTagPillNode(tagName);
  }

  exportJSON(): SerializedTagPillNode {
    return {
      tagName: this.__tagName,
      type: "tag-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-tag-pill", "true");
    element.setAttribute("data-tag-name", this.__tagName);
    element.textContent = this.__tagName;
    return { element };
  }

  getTextContent(): string {
    return this.__tagName;
  }

  getTagName(): string {
    return this.__tagName;
  }

  decorate(): JSX.Element {
    return (
      <Badge
        variant="secondary"
        className={cn("tw-inline-flex tw-items-center tw-gap-1 tw-px-2 tw-py-0.5 tw-text-xs")}
      >
        {this.__tagName}
      </Badge>
    );
  }
}

function convertTagPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const tagName = domNode.getAttribute("data-tag-name");
  if (tagName) {
    const node = $createTagPillNode(tagName);
    return {
      node,
    };
  }
  return null;
}

export function $createTagPillNode(tagName: string): TagPillNode {
  return new TagPillNode(tagName);
}

export function $isTagPillNode(node: LexicalNode | null | undefined): node is TagPillNode {
  return node instanceof TagPillNode;
}

// Add a utility function to remove pills by tag
export function $removePillsByTag(tagName: string): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: any): void {
    if ($isTagPillNode(node) && node.getTagName() === tagName) {
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
