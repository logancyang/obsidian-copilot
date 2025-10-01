import React from "react";
import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  $getRoot,
} from "lexical";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { TruncatedPillText } from "./TruncatedPillText";
import { PillBadge } from "./PillBadge";
import { useActiveFile } from "../context/ActiveFileContext";

// Active note pill doesn't store any file-specific data
// It always represents the current active file
export type SerializedActiveNotePillNode = SerializedBasePillNode;

/**
 * ActiveNotePillNode represents the "Current Note" in context
 * It automatically displays whatever file is currently active in Obsidian
 * This is a separate context type from regular notes
 */
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

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "active-note-pill-wrapper";
    return span;
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

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-active-note-pill", "true");
    element.textContent = "{activeNote}";
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

/**
 * Component that renders the active note pill
 * Uses ActiveFileContext to get the current active file and display its name
 */
function ActiveNotePillComponent(): JSX.Element {
  const currentActiveFile = useActiveFile();

  // If no active file, show {activeNote} to match what gets sent to LLM
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

  // Active file exists - show its name with "Current" label
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

// Utility functions
export function $createActiveNotePillNode(): ActiveNotePillNode {
  return new ActiveNotePillNode();
}

export function $isActiveNotePillNode(
  node: LexicalNode | null | undefined
): node is ActiveNotePillNode {
  return node instanceof ActiveNotePillNode;
}

/**
 * Removes all active note pills from the editor
 * @returns The number of pills removed
 */
export function $removeActiveNotePills(): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: any): void {
    if ($isActiveNotePillNode(node)) {
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
