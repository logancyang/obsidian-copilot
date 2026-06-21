import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalEditor,
  LexicalNode,
  NodeKey,
} from "lexical";
import { Bot } from "lucide-react";
import React from "react";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { PillBadge } from "./PillBadge";

export interface SerializedAgentPillNode extends SerializedBasePillNode {
  type: "agent-pill";
  /** Display label captured at insert time, so render needs no registry. */
  label: string;
}

/**
 * Agent pill node: a coding agent `@`-mentioned in the composer. Value is the
 * backend id, `label` the display name captured at insert time. Registry-agnostic
 * so the generic chat editor never depends on Agent Mode internals.
 */
export class AgentPillNode extends BasePillNode {
  __label: string;

  static getType(): string {
    return "agent-pill";
  }

  static clone(node: AgentPillNode): AgentPillNode {
    return new AgentPillNode(node.__value, node.__label, node.__key);
  }

  constructor(backendId: string, label: string, key?: NodeKey) {
    super(backendId, key);
    this.__label = label;
  }

  getClassName(): string {
    return "agent-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-agent-pill";
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-agent-pill")) {
          return {
            conversion: convertAgentPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedAgentPillNode): AgentPillNode {
    return $createAgentPillNode(serializedNode.value, serializedNode.label);
  }

  exportJSON(): SerializedAgentPillNode {
    return {
      ...super.exportJSON(),
      type: "agent-pill",
      label: this.__label,
    };
  }

  /** The mentioned backend id. */
  getBackendId(): string {
    return this.getValue();
  }

  /**
   * Contribute nothing to the serialized text. The backend id is pure routing
   * metadata (the mention feeds `mentionedAgents` structurally via the sync
   * plugin); emitting it here would leak the raw id into the prompt. The visible
   * pill comes from `decorate()`.
   */
  getTextContent(): string {
    return "";
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    // Base writes data-attribute/value/textContent; layer on the label so it
    // round-trips through DOM import.
    const out = super.exportDOM(editor);
    if (out.element instanceof HTMLElement) {
      out.element.setAttribute("data-pill-label", this.__label);
      out.element.textContent = this.__label || this.__value;
    }
    return out;
  }

  decorate(): JSX.Element {
    return (
      <PillBadge>
        <Bot className="tw-size-3" />
        {this.__label || this.__value}
      </PillBadge>
    );
  }
}

function convertAgentPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const value = domNode.getAttribute("data-pill-value");
  if (value !== null) {
    return { node: $createAgentPillNode(value, domNode.getAttribute("data-pill-label") ?? value) };
  }
  return null;
}

export function $createAgentPillNode(backendId: string, label: string): AgentPillNode {
  return new AgentPillNode(backendId, label);
}

export function $isAgentPillNode(node: LexicalNode): node is AgentPillNode {
  return node instanceof AgentPillNode;
}
