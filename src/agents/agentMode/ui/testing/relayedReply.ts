import { formatAgentReply } from "@/agents/agentReply";

export function relayedReply(name: string, reply: string): string {
  const agent = name.toLowerCase();
  return formatAgentReply({ agent, name, mention: `${agent}-run`, reply, changed: [] });
}
