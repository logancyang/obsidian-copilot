import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalEditor,
  LexicalNode,
  NodeKey,
} from "lexical";
import React from "react";
import { AgentGlyph } from "@/agents/ui/AgentGlyph";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { PillBadge } from "./PillBadge";

export interface SerializedAgentPillNode extends SerializedBasePillNode {
  type: "agent-pill";
  /** Display name captured at insert time, so render needs no roster. */
  label: string;
  /** The agent's emoji, captured with the name; "" when it set none. */
  icon?: string;
}

/**
 * Agent pill node: an agent `@`-mentioned in the composer. Value is the agent's
 * slug; `label` and `icon` are its name and emoji captured at insert time, so
 * the generic chat editor never depends on Agent Mode internals.
 */
export class AgentPillNode extends BasePillNode {
  __label: string;
  __icon: string;

  static getType(): string {
    return "agent-pill";
  }

  static clone(node: AgentPillNode): AgentPillNode {
    return new AgentPillNode(node.__value, node.__label, node.__icon, node.__key);
  }

  constructor(slug: string, label: string, icon: string = "", key?: NodeKey) {
    super(slug, key);
    this.__label = label;
    this.__icon = icon;
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
    return $createAgentPillNode(
      serializedNode.value,
      serializedNode.label,
      serializedNode.icon ?? ""
    );
  }

  exportJSON(): SerializedAgentPillNode {
    return {
      ...super.exportJSON(),
      type: "agent-pill",
      label: this.__label,
      icon: this.__icon,
    };
  }

  /** The mentioned agent's slug. */
  getAgentSlug(): string {
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
    // Base writes data-attribute/value/textContent; layer on the label and icon
    // so they round-trip through DOM import.
    const out = super.exportDOM(editor);
    if (out.element instanceof HTMLElement) {
      out.element.setAttribute("data-pill-label", this.__label);
      if (this.__icon) out.element.setAttribute("data-pill-icon", this.__icon);
      out.element.textContent = this.__label || this.__value;
    }
    return out;
  }

  decorate(): JSX.Element {
    return <AgentPillContent icon={this.__icon} label={this.__label || this.__value} />;
  }
}

/** Pill body: the agent's face and name, matching how every other surface names it. */
export function AgentPillContent({ icon, label }: { icon: string; label: string }) {
  return (
    <PillBadge>
      <AgentGlyph icon={icon} className="tw-size-3" />
      {label}
    </PillBadge>
  );
}

function convertAgentPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const value = domNode.getAttribute("data-pill-value");
  if (value !== null) {
    return {
      node: $createAgentPillNode(
        value,
        domNode.getAttribute("data-pill-label") ?? value,
        domNode.getAttribute("data-pill-icon") ?? ""
      ),
    };
  }
  return null;
}

export function $createAgentPillNode(slug: string, label: string, icon = ""): AgentPillNode {
  return new AgentPillNode(slug, label, icon);
}

export function $isAgentPillNode(node: LexicalNode): node is AgentPillNode {
  return node instanceof AgentPillNode;
}
