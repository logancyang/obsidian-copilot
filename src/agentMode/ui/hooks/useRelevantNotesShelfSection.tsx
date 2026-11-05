import type { AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { RelevantNotesShelfPanel } from "@/agentMode/ui/RelevantNotesShelfPanel";
import { useRelevantNotesPaneOpen } from "@/agentMode/ui/useRelevantNotesPaneOpen";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import { cn } from "@/lib/utils";
import type CopilotPlugin from "@/main";
import { FileSearch } from "lucide-react";
import type { App } from "obsidian";
import React, { useMemo } from "react";

export function useRelevantNotesShelfSection(
  app: App,
  plugin: CopilotPlugin
): AgentHomeShelfSection | null {
  const isPaneOpen = useRelevantNotesPaneOpen(app);
  return useMemo(
    () =>
      isPaneOpen
        ? null
        : {
            id: "relevant-notes",
            icon: <FileSearch className="tw-size-4" />,
            title: "Relevant Notes",
            renderBody: () => (
              <RelevantNotesShelfPanel onPopOut={() => void plugin.activateRelevantNotesView()}>
                <RelevantNotes
                  className={cn("[&>[data-relevant-notes-empty-state]]:tw-py-6")}
                  onAddToChat={(note) => void plugin.addNoteToActiveChat(note)}
                />
              </RelevantNotesShelfPanel>
            ),
          },
    [isPaneOpen, plugin]
  );
}
