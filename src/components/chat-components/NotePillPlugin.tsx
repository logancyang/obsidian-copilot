import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  DecoratorNode,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  DELETE_CHARACTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from "lexical";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface SerializedNotePillNode extends SerializedLexicalNode {
  noteTitle: string;
  notePath: string;
  isActive?: boolean;
}

export class NotePillNode extends DecoratorNode<JSX.Element> {
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
    super(key);
    this.__noteTitle = noteTitle;
    this.__notePath = notePath;
    this.__isActive = isActive;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "note-pill-wrapper";
    return span;
  }

  updateDOM(): false {
    return false;
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
    element.textContent = `[[${this.__noteTitle}]]`;
    return { element };
  }

  getTextContent(): string {
    return `[[${this.__noteTitle}]]`;
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

  isInline(): boolean {
    return true;
  }

  canInsertTextBefore(): boolean {
    return true;
  }

  canInsertTextAfter(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  isIsolated(): boolean {
    return true;
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

interface NotePillComponentProps {
  node: NotePillNode;
}

function NotePillComponent({ node }: NotePillComponentProps): JSX.Element {
  const noteTitle = node.getNoteTitle();
  const isActive = node.getActive();

  return (
    <Badge
      variant="secondary"
      className={cn(
        "tw-mx-0.5 tw-items-center tw-px-2 tw-py-0 tw-text-xs",
        isActive && "tw-bg-accent"
      )}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <span>[[{noteTitle}]]</span>
        {isActive && <span className="tw-text-xs tw-text-faint">Current</span>}
      </div>
    </Badge>
  );
}

export function NotePillPlugin(): null {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const removeDeleteCommand = editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (isBackward: boolean): boolean => {
        let handled = false;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            handled = false;
            return;
          }

          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();

          // If cursor is directly on a pill node
          if ($isNotePillNode(anchorNode)) {
            // Backspace when cursor is after the pill (offset 1)
            if (isBackward && anchor.offset === 1) {
              anchorNode.remove();
              handled = true;
              return;
            }
            // Delete when cursor is before the pill (offset 0)
            if (!isBackward && anchor.offset === 0) {
              anchorNode.remove();
              handled = true;
              return;
            }
            handled = false;
            return;
          }

          // Handle backspace at start of text node - check previous sibling
          if (isBackward && anchor.offset === 0) {
            const previousSibling = anchorNode.getPreviousSibling();
            if ($isNotePillNode(previousSibling)) {
              previousSibling.remove();
              handled = true;
              return;
            }
          }

          // Handle delete at end of text node - check next sibling
          if (!isBackward && anchor.offset === anchorNode.getTextContent().length) {
            const nextSibling = anchorNode.getNextSibling();
            if ($isNotePillNode(nextSibling)) {
              nextSibling.remove();
              handled = true;
              return;
            }
          }

          handled = false;
        });
        return handled;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      removeDeleteCommand();
    };
  }, [editor]);

  return null;
}

// Add a utility function to remove pills by path
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
