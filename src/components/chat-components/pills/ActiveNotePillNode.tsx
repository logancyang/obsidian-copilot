import React from "react";
import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  $getRoot,
} from "lexical";
import { BasePillNode, getEditorDocument, SerializedBasePillNode } from "./BasePillNode";
import { TruncatedPillText } from "./TruncatedPillText";
import { PillBadge } from "./PillBadge";
import { useActiveFile } from "@/components/chat-components/context/ActiveFileContext";

export type SerializedActiveNotePillNode = SerializedBasePillNode;

export class ActiveNotePillNode extends BasePillNode {
  static getType(): string {
    return "active-note-pill";
  }

  static clone(node: ActiveNotePillNode): ActiveNotePillNode {
    return new ActiveNotePillNode(node.__key);
  }

  constructor(key?: NodeKey) {
    super("Current Note", key);
  }

  getClassName(): string {
    return "active-note-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-active-note-pill";
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-active-note-pill")) {
          return {
            conversion: convertActiveNotePillElement,
            priority: 2,
          };
        }
        return null;
      },
    };
  }

  static importJSON(_serializedNode: SerializedActiveNotePillNode): ActiveNotePillNode {
    return $createActiveNotePillNode();
  }

  exportJSON(): SerializedActiveNotePillNode {
    return {
      ...super.exportJSON(),
      type: "active-note-pill",
      version: 1,
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = getEditorDocument(editor).win.createSpan({
      text: "{activeNote}",
      attr: { "data-lexical-active-note-pill": "true" },
    });
    return { element };
  }

  getTextContent(): string {
    return "{activeNote}";
  }

  decorate(): JSX.Element {
    return <ActiveNotePillComponent />;
  }
}

function convertActiveNotePillElement(_domNode: HTMLElement): DOMConversionOutput | null {
  const node = $createActiveNotePillNode();
  return { node };
}

function ActiveNotePillComponent(): JSX.Element {
  const currentActiveFile = useActiveFile();

  if (!currentActiveFile) {
    return (
      <PillBadge>
        <div className="tw-flex tw-items-center tw-gap-1">
          <TruncatedPillText
            content="activeNote"
            openBracket="{"
            closeBracket="}"
            tooltipContent={
              <div className="tw-text-left">
                Will use the active note at the time the message is sent
              </div>
            }
          />
        </div>
      </PillBadge>
    );
  }

  const noteTitle = currentActiveFile.basename;
  const notePath = currentActiveFile.path;
  const isPdf = notePath.toLowerCase().endsWith(".pdf");

  return (
    <PillBadge>
      <div className="tw-flex tw-items-center tw-gap-1">
        <TruncatedPillText
          content={noteTitle}
          openBracket="[["
          closeBracket="]]"
          tooltipContent={<div className="tw-text-left">{notePath}</div>}
        />
        <span className="tw-text-xs tw-text-faint">Current</span>
        {isPdf && <span className="tw-text-xs tw-text-faint">pdf</span>}
      </div>
    </PillBadge>
  );
}

export function $createActiveNotePillNode(): ActiveNotePillNode {
  return new ActiveNotePillNode();
}

export function $isActiveNotePillNode(
  node: LexicalNode | null | undefined
): node is ActiveNotePillNode {
  return node instanceof ActiveNotePillNode;
}

export function $removeActiveNotePills(): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: LexicalNode): void {
    if ($isActiveNotePillNode(node)) {
      node.remove();
      removedCount++;
    } else if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = node.getChildren() as LexicalNode[];
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return removedCount;
}
