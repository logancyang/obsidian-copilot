import { $getRoot, DOMConversionMap, DOMConversionOutput, LexicalNode, NodeKey } from "lexical";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";

export interface SerializedToolPillNode extends SerializedBasePillNode {
  type: "tool-pill";
}

/**
 * Tool pill node for representing tools in the editor.
 */
export class ToolPillNode extends BasePillNode {
  static getType(): string {
    return "tool-pill";
  }

  static clone(node: ToolPillNode): ToolPillNode {
    return new ToolPillNode(node.__value, node.__key);
  }

  constructor(toolName: string, key?: NodeKey) {
    super(toolName, key);
  }

  getClassName(): string {
    return "tool-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-tool-pill";
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
    const { value } = serializedNode;
    return $createToolPillNode(value);
  }

  exportJSON(): SerializedToolPillNode {
    return {
      ...super.exportJSON(),
      type: "tool-pill",
    };
  }

  // Convenience getter for backward compatibility
  getToolName(): string {
    return this.getValue();
  }
}

function convertToolPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const value = domNode.getAttribute("data-pill-value");
  if (value !== null) {
    const node = $createToolPillNode(value);
    return { node };
  }
  return null;
}

// Utility functions
export function $createToolPillNode(toolName: string): ToolPillNode {
  return new ToolPillNode(toolName);
}

export function $isToolPillNode(node: any): node is ToolPillNode {
  return node instanceof ToolPillNode;
}

export function $findToolPills(): ToolPillNode[] {
  const root = $getRoot();
  const pills: ToolPillNode[] = [];

  function traverse(node: LexicalNode) {
    if (node instanceof ToolPillNode) {
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

export function $removePillsByToolName(toolName: string): void {
  const pills = $findToolPills();
  for (const pill of pills) {
    if (pill.getValue() === toolName) {
      pill.remove();
    }
  }
}
