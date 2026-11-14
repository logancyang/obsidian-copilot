import React from "react";
import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalEditor,
  LexicalNode,
  NodeKey,
} from "lexical";
import { BasePillNode, getEditorDocument, SerializedBasePillNode } from "./BasePillNode";
import { TruncatedPillText } from "./TruncatedPillText";
import { PillBadge } from "./PillBadge";

export interface SerializedFolderPillNode extends SerializedBasePillNode {
  type: "folder-pill";
}

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

  decorate(): JSX.Element {
    const tooltipContent = <div className="tw-text-left">{this.getFolderPath()}</div>;

    return (
      <PillBadge>
        <TruncatedPillText
          content={this.getFolderPath()}
          openBracket="{"
          closeBracket="}"
          tooltipContent={tooltipContent}
        />
      </PillBadge>
    );
  }

  getTextContent(): string {
    return `{${this.getFolderPath()}}`;
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = getEditorDocument(editor).win.createSpan({
      text: `{${this.getFolderPath()}}`,
      attr: { [this.getDataAttribute()]: "", "data-pill-value": this.__value },
    });
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

export function $createFolderPillNode(folderPath: string): FolderPillNode {
  return new FolderPillNode(folderPath);
}

export function $isFolderPillNode(node: LexicalNode): node is FolderPillNode {
  return node instanceof FolderPillNode;
}
