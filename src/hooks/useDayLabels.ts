import { dayLabels, startOfDay } from "@/lib/messageTime";
import type { ChatMessage } from "@/types/message";
import { useMemo, useSyncExternalStore } from "react";

const RECHECK_MS = 60 * 1000;

// A timer set for midnight runs late by however long the computer slept, so the day is rechecked each minute.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/971
function subscribeToDay(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, RECHECK_MS);
  return () => window.clearInterval(timer);
}

function getToday(): number {
  return startOfDay(Date.now());
}

export function useDayLabels(
  messages: ReadonlyArray<Pick<ChatMessage, "timestamp" | "isVisible">>
): Map<number, string> {
  const today = useSyncExternalStore(subscribeToDay, getToday);
  return useMemo(
    () =>
      dayLabels(
        messages.map((m) => (m.isVisible ? m.timestamp?.epoch : undefined)),
        today
      ),
    [messages, today]
  );
}
