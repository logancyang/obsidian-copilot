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
  $getRoot,
} from "lexical";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { IPillNode } from "./PillDeletionPlugin";

export interface SerializedToolPillNode extends SerializedLexicalNode {
  toolName: string;
}

export class ToolPillNode extends DecoratorNode<JSX.Element> implements IPillNode {
  __toolName: string;

  static getType(): string {
    return "tool-pill";
  }

  static clone(node: ToolPillNode): ToolPillNode {
    return new ToolPillNode(node.__toolName, node.__key);
  }

  constructor(toolName: string, key?: NodeKey) {
    super(key);
    this.__toolName = toolName;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "tool-pill-wrapper";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-tool-pill")) {
          return {
            conversion: convertToolPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedToolPillNode): ToolPillNode {
    const { toolName } = serializedNode;
    return $createToolPillNode(toolName);
  }

  exportJSON(): SerializedToolPillNode {
    return {
      toolName: this.__toolName,
      type: "tool-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-tool-pill", "true");
    element.setAttribute("data-tool-name", this.__toolName);
    element.textContent = this.__toolName;
    return { element };
  }

  getTextContent(): string {
    return this.__toolName;
  }

  isPill(): boolean {
    return true;
  }

  getToolName(): string {
    return this.__toolName;
  }

  decorate(): JSX.Element {
    return (
      <Badge
        variant="secondary"
        className={cn("tw-inline-flex tw-items-center tw-gap-1 tw-px-2 tw-py-0.5 tw-text-xs")}
      >
        {this.__toolName}
      </Badge>
    );
  }
}

function convertToolPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const toolName = domNode.getAttribute("data-tool-name");
  if (toolName) {
    const node = $createToolPillNode(toolName);
    return {
      node,
    };
  }
  return null;
}

export function $createToolPillNode(toolName: string): ToolPillNode {
  return new ToolPillNode(toolName);
}

export function $isToolPillNode(node: LexicalNode | null | undefined): node is ToolPillNode {
  return node instanceof ToolPillNode;
}

// Utility function to remove pills by tool name
export function $removePillsByToolName(toolName: string): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: any): void {
    if ($isToolPillNode(node) && node.getToolName() === toolName) {
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
