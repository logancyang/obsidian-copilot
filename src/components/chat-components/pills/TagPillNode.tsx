import React from "react";
import { $getRoot, DOMConversionMap, DOMConversionOutput, LexicalNode, NodeKey } from "lexical";
import { Badge } from "@/components/ui/badge";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { TruncatedPillText } from "./TruncatedPillText";

export interface SerializedTagPillNode extends SerializedBasePillNode {
  type: "tag-pill";
}

/**
 * Tag pill node for representing tags in the editor.
 */
export class TagPillNode extends BasePillNode {
  static getType(): string {
    return "tag-pill";
  }

  static clone(node: TagPillNode): TagPillNode {
    return new TagPillNode(node.__value, node.__key);
  }

  constructor(tagName: string, key?: NodeKey) {
    super(tagName, key);
  }

  getClassName(): string {
    return "tag-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-tag-pill";
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
    const { value } = serializedNode;
    return $createTagPillNode(value);
  }

  exportJSON(): SerializedTagPillNode {
    return {
      ...super.exportJSON(),
      type: "tag-pill",
    };
  }

  // Convenience getter for backward compatibility
  getTagName(): string {
    return this.getValue();
  }

  /**
   * Override to display tag name with truncation and tooltip support
   */
  decorate(): JSX.Element {
    return (
      <Badge
        variant="secondary"
        className="tw-mx-0.5 tw-inline-flex tw-items-center tw-gap-1 tw-px-2 tw-py-0 tw-align-middle tw-text-xs"
      >
        <TruncatedPillText content={this.getValue()} openBracket="" closeBracket="" />
      </Badge>
    );
  }
}

function convertTagPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const value = domNode.getAttribute("data-pill-value");
  if (value !== null) {
    const node = $createTagPillNode(value);
    return { node };
  }
  return null;
}

// Utility functions
export function $createTagPillNode(tagName: string): TagPillNode {
  return new TagPillNode(tagName);
}

export function $isTagPillNode(node: any): node is TagPillNode {
  return node instanceof TagPillNode;
}

export function $findTagPills(): TagPillNode[] {
  const root = $getRoot();
  const pills: TagPillNode[] = [];

  function traverse(node: LexicalNode) {
    if (node instanceof TagPillNode) {
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

export function $removePillsByTag(tagName: string): void {
  const pills = $findTagPills();
  for (const pill of pills) {
    if (pill.getValue() === tagName) {
      pill.remove();
    }
  }
}
