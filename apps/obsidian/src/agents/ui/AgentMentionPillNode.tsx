import { AgentFace } from "@/agents/ui/AgentFace";
import { useChatAgents } from "@/agents/ui/chatAgents";
import {
  BasePillNode,
  type SerializedBasePillNode,
} from "@/components/chat-components/pills/BasePillNode";
import { PillBadge } from "@/components/chat-components/pills/PillBadge";
import type { LexicalNode, NodeKey } from "lexical";
import React from "react";

const AGENT_PILL_TYPE = "custom-agent-pill";

interface SerializedAgentMentionPillNode extends SerializedBasePillNode {
  name: string;
}

export const AgentMentionPill: React.FC<{ name: string; faceSrc?: string }> = ({
  name,
  faceSrc,
}) => (
  <PillBadge>
    {faceSrc ? <AgentFace src={faceSrc} size="xs" className="tw-size-3.5" /> : null}
    {name}
  </PillBadge>
);

const ChatAgentPill: React.FC<{ slug: string; name: string }> = ({ slug, name }) => {
  const agent = useChatAgents().find((candidate) => candidate.slug === slug);
  return <AgentMentionPill name={name} faceSrc={agent?.faceSrc} />;
};

export class AgentMentionPillNode extends BasePillNode {
  __name: string;

  static getType(): string {
    return AGENT_PILL_TYPE;
  }

  static clone(node: AgentMentionPillNode): AgentMentionPillNode {
    return new AgentMentionPillNode(node.__value, node.__name, node.__key);
  }

  static importJSON(serialized: SerializedAgentMentionPillNode): AgentMentionPillNode {
    return $createAgentMentionPillNode(serialized.value, serialized.name);
  }

  constructor(slug: string, name: string, key?: NodeKey) {
    super(slug, key);
    this.__name = name;
  }

  exportJSON(): SerializedAgentMentionPillNode {
    return { ...super.exportJSON(), type: AGENT_PILL_TYPE, name: this.__name };
  }

  getClassName(): string {
    return "custom-agent-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-custom-agent-pill";
  }

  getTextContent(): string {
    return `@${this.__name}`;
  }

  decorate(): JSX.Element {
    return <ChatAgentPill slug={this.__value} name={this.__name} />;
  }
}

export function $createAgentMentionPillNode(slug: string, name: string): AgentMentionPillNode {
  return new AgentMentionPillNode(slug, name);
}

export function $isAgentMentionPillNode(
  node: LexicalNode | null | undefined
): node is AgentMentionPillNode {
  return node instanceof AgentMentionPillNode;
}
