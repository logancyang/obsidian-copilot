import React from "react";
import {
  DecoratorNode,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  NodeKey,
  SerializedLexicalNode,
} from "lexical";
import { IPillNode } from "../plugins/PillDeletionPlugin";
import { PillBadge } from "./PillBadge";

/**
 * Returns the Document that owns the given Lexical editor's root element.
 * Pills must create DOM in the editor's window — using `activeDocument`
 * (focused window) can produce nodes with the wrong owner when the chat is
 * in an Obsidian popout but a different window is focused.
 */
export function getEditorDocument(editor: LexicalEditor): Document {
  return editor.getRootElement()?.doc ?? activeDocument;
}

export interface SerializedBasePillNode extends SerializedLexicalNode {
  value: string;
}

/**
 * Abstract base class for all pill nodes that provides common pill behaviors.
 * This ensures consistent cursor navigation and interaction across all pill types.
 */
export abstract class BasePillNode extends DecoratorNode<JSX.Element> implements IPillNode {
  __value: string;

  constructor(value: string, key?: NodeKey) {
    super(key);
    this.__value = value;
  }

  /**
   * Pills are decorator nodes that don't need DOM updates.
   */
  updateDOM(): false {
    return false;
  }

  /**
   * Pills are inline elements that flow with text.
   */
  isInline(): boolean {
    return true;
  }

  /**
   * Allow cursor to be placed before the pill.
   */
  canInsertTextBefore(): boolean {
    return true;
  }

  /**
   * Allow cursor to be placed after the pill.
   */
  canInsertTextAfter(): boolean {
    return true;
  }

  /**
   * Pills cannot be empty.
   */
  canBeEmpty(): boolean {
    return false;
  }

  /**
   * Pills can be selected with keyboard navigation.
   */
  isKeyboardSelectable(): boolean {
    return true;
  }

  /**
   * Pills are treated as isolated units for selection and deletion.
   */
  isIsolated(): boolean {
    return true;
  }

  /**
   * Identifies this node as a pill for the deletion plugin.
   */
  isPill(): boolean {
    return true;
  }

  /**
   * Get the current value of the pill.
   */
  getValue(): string {
    return this.__value;
  }

  /**
   * Set the value of the pill.
   */
  setValue(value: string): void {
    const writable = this.getWritable();
    writable.__value = value;
  }

  /**
   * Default text content is the value.
   */
  getTextContent(): string {
    return this.__value;
  }

  /**
   * Default DOM creation - subclasses can override for custom elements.
   */
  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const span = getEditorDocument(editor).createElement("span");
    span.className = this.getClassName();
    return span;
  }

  /**
   * Default DOM export - subclasses can override for custom attributes.
   */
  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = getEditorDocument(editor).createElement("span");
    element.setAttribute(this.getDataAttribute(), "");
    element.setAttribute("data-pill-value", this.__value);
    element.textContent = this.__value;
    return { element };
  }

  /**
   * Default JSON export - subclasses can override for additional data.
   */
  exportJSON(): SerializedBasePillNode {
    return {
      ...super.exportJSON(),
      value: this.__value,
      type: this.getType(),
      version: 1,
    };
  }

  /**
   * Default rendering with PillBadge component - subclasses can override for custom rendering.
   */
  decorate(): JSX.Element {
    return <PillBadge>{this.__value}</PillBadge>;
  }

  // Abstract methods that subclasses must implement

  /**
   * Returns the CSS class name for this pill type.
   */
  abstract getClassName(): string;

  /**
   * Returns the data attribute name for DOM operations.
   */
  abstract getDataAttribute(): string;
}
