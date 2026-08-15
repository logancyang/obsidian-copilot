import type { AcpSessionUpdate } from "@/agentMode/acp/types";

const SKILLS_BUDGET_WARNING_PREFIX = "Warning: Skill descriptions were shortened to fit ";
const SKILLS_BUDGET_WARNING_MARKER = "skills context budget.";

export function shouldRouteCodexSessionUpdate(update: AcpSessionUpdate): boolean {
  if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") {
    return true;
  }

  const text = update.content.text.trim();
  return !(
    text.startsWith(SKILLS_BUDGET_WARNING_PREFIX) && text.includes(SKILLS_BUDGET_WARNING_MARKER)
  );
}
