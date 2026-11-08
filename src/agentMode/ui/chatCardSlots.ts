import type { ChatCardSlot } from "@/agentMode/ui/chatCards";
import { feedbackCardSlot } from "@/agentMode/ui/FeedbackCard";
import { connectorCardSlot } from "@/connectors/agentMode/connectorCardSlot";

export const CHAT_CARD_SLOTS: readonly ChatCardSlot<unknown>[] = [
  feedbackCardSlot,
  connectorCardSlot,
];
