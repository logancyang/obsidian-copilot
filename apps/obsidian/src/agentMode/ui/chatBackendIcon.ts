import { backendRegistry } from "@/agentMode/backends/registry";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { MessageCircle } from "lucide-react";
import type React from "react";

export function chatBackendIcon(
  item: Pick<ChatHistoryItem, "backendId">
): React.ComponentType<{ className?: string }> {
  return (item.backendId && backendRegistry[item.backendId]?.Icon) || MessageCircle;
}
