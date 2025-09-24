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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";

export interface SerializedNotePillNode extends SerializedBasePillNode {
  noteTitle: string;
  notePath: string;
  isActive?: boolean;
}

export class NotePillNode extends BasePillNode {
  __noteTitle: string;
  __notePath: string;
  __isActive: boolean;

  static getType(): string {
    return "note-pill";
  }

  static clone(node: NotePillNode): NotePillNode {
    return new NotePillNode(node.__noteTitle, node.__notePath, node.__isActive, node.__key);
  }

  constructor(noteTitle: string, notePath: string, isActive = false, key?: NodeKey) {
    super(noteTitle, key);
    this.__noteTitle = noteTitle;
    this.__notePath = notePath;
    this.__isActive = isActive;
  }

  getClassName(): string {
    return "note-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-note-pill";
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "note-pill-wrapper";
    return span;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-note-pill")) {
          return {
            conversion: convertNotePillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedNotePillNode): NotePillNode {
    const { noteTitle, notePath, isActive } = serializedNode;
    return $createNotePillNode(noteTitle, notePath, isActive);
  }

  exportJSON(): SerializedNotePillNode {
    return {
      ...super.exportJSON(),
      noteTitle: this.__noteTitle,
      notePath: this.__notePath,
      isActive: this.__isActive,
      type: "note-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-note-pill", "true");
    element.setAttribute("data-note-title", this.__noteTitle);
    element.setAttribute("data-note-path", this.__notePath);
    const displayName = this.__notePath.toLowerCase().endsWith(".pdf")
      ? `${this.__noteTitle}.pdf`
      : this.__noteTitle;
    element.textContent = `[[${displayName}]]`;
    return { element };
  }

  getTextContent(): string {
    const displayName = this.__notePath.toLowerCase().endsWith(".pdf")
      ? `${this.__noteTitle}.pdf`
      : this.__noteTitle;
    return `[[${displayName}]]`;
  }

  setActive(isActive: boolean): void {
    const writable = this.getWritable();
    writable.__isActive = isActive;
  }

  getActive(): boolean {
    return this.__isActive;
  }

  getNoteTitle(): string {
    return this.__noteTitle;
  }

  getNotePath(): string {
    return this.__notePath;
  }

  decorate(): JSX.Element {
    return <NotePillComponent node={this} />;
  }
}

function convertNotePillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const noteTitle = domNode.getAttribute("data-note-title");
  const notePath = domNode.getAttribute("data-note-path");
  if (noteTitle && notePath) {
    const node = $createNotePillNode(noteTitle, notePath);
    return { node };
  }
  return null;
}

interface NotePillComponentProps {
  node: NotePillNode;
}

function NotePillComponent({ node }: NotePillComponentProps): JSX.Element {
  const noteTitle = node.getNoteTitle();
  const notePath = node.getNotePath();
  const isActive = node.getActive();
  const isPdf = notePath.toLowerCase().endsWith(".pdf");

  return (
    <Badge
      variant="secondary"
      className={cn("tw-mx-0.5 tw-items-center tw-px-2 tw-py-0 tw-text-xs")}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <span className="tw-max-w-40 tw-truncate">[[{noteTitle}]]</span>
        {isActive && <span className="tw-text-xs tw-text-faint">Current</span>}
        {isPdf && <span className="tw-text-xs tw-text-faint">pdf</span>}
      </div>
    </Badge>
  );
}

// Utility functions
export function $createNotePillNode(
  noteTitle: string,
  notePath: string,
  isActive = false
): NotePillNode {
  return new NotePillNode(noteTitle, notePath, isActive);
}

export function $isNotePillNode(node: LexicalNode | null | undefined): node is NotePillNode {
  return node instanceof NotePillNode;
}

export function $findNotePills(): NotePillNode[] {
  const root = $getRoot();
  const pills: NotePillNode[] = [];

  function traverse(node: LexicalNode) {
    if (node instanceof NotePillNode) {
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

export function $removePillsByPath(notePath: string): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: any): void {
    if ($isNotePillNode(node) && node.getNotePath() === notePath) {
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
