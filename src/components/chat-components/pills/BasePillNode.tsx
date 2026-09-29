import React from "react";
import {
  DecoratorNode,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  NodeKey,
  SerializedLexicalNode,
} from "lexical";
import { IPillNode } from "@/components/chat-components/plugins/PillDeletionPlugin";
import { PillBadge } from "./PillBadge";

export function getEditorDocument(editor: LexicalEditor): Document {
  return editor.getRootElement()?.doc ?? activeDocument;
}

export interface SerializedBasePillNode extends SerializedLexicalNode {
  value: string;
}

export abstract class BasePillNode extends DecoratorNode<JSX.Element> implements IPillNode {
  __value: string;

  constructor(value: string, key?: NodeKey) {
    super(key);
    this.__value = value;
  }

  updateDOM(): false {
    return false;
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

  isPill(): boolean {
    return true;
  }

  getValue(): string {
    return this.__value;
  }

  setValue(value: string): void {
    const writable = this.getWritable();
    writable.__value = value;
  }

  getTextContent(): string {
    return this.__value;
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    return getEditorDocument(editor).win.createSpan(this.getClassName());
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = getEditorDocument(editor).win.createSpan({
      text: this.__value,
      attr: { [this.getDataAttribute()]: "", "data-pill-value": this.__value },
    });
    return { element };
  }

  exportJSON(): SerializedBasePillNode {
    return {
      ...super.exportJSON(),
      value: this.__value,
      type: this.getType(),
      version: 1,
    };
  }

  decorate(): JSX.Element {
    return <PillBadge>{this.__value}</PillBadge>;
  }

  abstract getClassName(): string;

  abstract getDataAttribute(): string;
}
