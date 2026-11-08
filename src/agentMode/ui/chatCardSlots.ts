import type { ChatCardSlot } from "@/agentMode/ui/chatCards";
import { feedbackCardSlot } from "@/agentMode/ui/FeedbackCard";

export const CHAT_CARD_SLOTS: readonly ChatCardSlot<unknown>[] = [feedbackCardSlot];
