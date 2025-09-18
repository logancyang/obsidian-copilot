import React from "react";
import {
  DecoratorNode,
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
import { IPillNode } from "./PillDeletionPlugin";
import { Folder } from "lucide-react";

export interface SerializedFolderPillNode extends SerializedLexicalNode {
  folderName: string;
  folderPath: string;
}

export class FolderPillNode extends DecoratorNode<JSX.Element> implements IPillNode {
  __folderName: string;
  __folderPath: string;

  static getType(): string {
    return "folder-pill";
  }

  static clone(node: FolderPillNode): FolderPillNode {
    return new FolderPillNode(node.__folderName, node.__folderPath, node.__key);
  }

  constructor(folderName: string, folderPath: string, key?: NodeKey) {
    super(key);
    this.__folderName = folderName;
    this.__folderPath = folderPath;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "folder-pill-wrapper";
    return span;
  }

  updateDOM(): false {
    return false;
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
    const { folderName, folderPath } = serializedNode;
    return $createFolderPillNode(folderName, folderPath);
  }

  exportJSON(): SerializedFolderPillNode {
    return {
      folderName: this.__folderName,
      folderPath: this.__folderPath,
      type: "folder-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-folder-pill", "true");
    element.setAttribute("data-folder-name", this.__folderName);
    element.setAttribute("data-folder-path", this.__folderPath);
    element.textContent = this.__folderName;
    return { element };
  }

  getTextContent(): string {
    return this.__folderName;
  }

  isPill(): boolean {
    return true;
  }

  getFolderName(): string {
    return this.__folderName;
  }

  getFolderPath(): string {
    return this.__folderPath;
  }

  decorate(): JSX.Element {
    return (
      <Badge
        variant="secondary"
        className={cn("tw-inline-flex tw-items-center tw-gap-1 tw-px-2 tw-py-0.5 tw-text-xs")}
      >
        <Folder className="tw-size-3" />
        {this.__folderName}
      </Badge>
    );
  }
}

function convertFolderPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const folderName = domNode.getAttribute("data-folder-name");
  const folderPath = domNode.getAttribute("data-folder-path");
  if (folderName && folderPath) {
    const node = $createFolderPillNode(folderName, folderPath);
    return {
      node,
    };
  }
  return null;
}

export function $createFolderPillNode(folderName: string, folderPath: string): FolderPillNode {
  return new FolderPillNode(folderName, folderPath);
}

export function $isFolderPillNode(node: LexicalNode | null | undefined): node is FolderPillNode {
  return node instanceof FolderPillNode;
}
