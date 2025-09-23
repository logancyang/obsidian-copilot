import React from "react";
import {
  $getRoot,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
} from "lexical";
import { Badge } from "@/components/ui/badge";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";

export interface SerializedFolderPillNode extends SerializedBasePillNode {
  type: "folder-pill";
}

/**
 * Folder pill node for representing folders in the editor.
 */
export class FolderPillNode extends BasePillNode {
  static getType(): string {
    return "folder-pill";
  }

  static clone(node: FolderPillNode): FolderPillNode {
    return new FolderPillNode(node.__value, node.__key);
  }

  constructor(folderPath: string, key?: NodeKey) {
    super(folderPath, key);
  }

  getClassName(): string {
    return "folder-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-folder-pill";
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-folder-pill")) {
          return {
            conversion: convertFolderPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedFolderPillNode): FolderPillNode {
    const { value } = serializedNode;
    return $createFolderPillNode(value);
  }

  exportJSON(): SerializedFolderPillNode {
    return {
      ...super.exportJSON(),
      type: "folder-pill",
    };
  }

  /**
   * Override to display folder name wrapped in curly braces
   */
  decorate(): JSX.Element {
    return (
      <Badge
        variant="secondary"
        className="tw-inline-flex tw-items-center tw-gap-1 tw-whitespace-nowrap tw-text-xs"
      >
        {`{${this.getFolderPath()}}`}
      </Badge>
    );
  }

  /**
   * Override to return text content with curly braces
   */
  getTextContent(): string {
    return `{${this.getFolderPath()}}`;
  }

  /**
   * Override to export DOM with curly braces
   */
  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute(this.getDataAttribute(), "");
    element.setAttribute("data-pill-value", this.__value);
    element.textContent = `{${this.getFolderPath()}}`;
    return { element };
  }

  getFolderPath(): string {
    return this.getValue();
  }
}

function convertFolderPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const value = domNode.getAttribute("data-pill-value");
  if (value !== null) {
    const node = $createFolderPillNode(value);
    return { node };
  }
  return null;
}

// Utility functions
export function $createFolderPillNode(folderPath: string): FolderPillNode {
  return new FolderPillNode(folderPath);
}

export function $isFolderPillNode(node: any): node is FolderPillNode {
  return node instanceof FolderPillNode;
}

export function $findFolderPills(): FolderPillNode[] {
  const root = $getRoot();
  const pills: FolderPillNode[] = [];

  function traverse(node: LexicalNode) {
    if (node instanceof FolderPillNode) {
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

export function $removePillsByFolder(folderPath: string): void {
  const pills = $findFolderPills();
  for (const pill of pills) {
    if (pill.getValue() === folderPath) {
      pill.remove();
    }
  }
}
