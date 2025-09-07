import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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

  createDOM(config: EditorConfig): HTMLElement {
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
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  canBeEmpty(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
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
    // This plugin is mainly for registering the node type
    // The actual conversion from [[note]] to pills is handled by the NoteCommandPlugin
    // We could add a transform here if needed for paste handling or other cases
    return () => {};
  }, [editor]);

  return null;
}
