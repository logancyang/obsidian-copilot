import type { AgentEntry } from "@/agents/types";
import { AgentGlyph } from "@/agents/ui/AgentGlyph";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BookOpen, Check, ChevronDown, Eraser } from "lucide-react";
import React from "react";

export interface AgentTalkingToPickerProps {
  /** The built-in Copilot first, then every agent on disk. */
  entries: readonly AgentEntry[];
  /** Slug of the entry the trigger shows. */
  selectedSlug: string;
  /** Talk to another agent from now on. */
  onSelect: (slug: string) => void;
  /**
   * Called as the menu opens, so the list reflects an agent created in Settings
   * a moment ago without waiting for a reload.
   */
  onOpen?: () => void;
  /** Open the selected agent's `MEMORY.md`. */
  onOpenMemory?: (slug: string) => void;
  /** Reset the selected agent's `MEMORY.md` to its empty skeleton. */
  onClearMemory?: (slug: string) => void;
  /** Portal container, so the menu stays in the right window in a popout. */
  container?: HTMLElement | null;
  className?: string;
}

/**
 * "Talking to" control at the top-left of Agent Home, in the global scope and
 * inside a project alike. It reads Copilot until the user has agents, and
 * choosing one applies to the next new chat and to any chat that has not sent a
 * message yet. Scope and agent are orthogonal — this changes who answers, never
 * the working directory or what Recent Chats lists.
 *
 * See `designdocs/CUSTOM_AGENTS.md` §3 ("Choosing who you are talking to").
 */
export const AgentTalkingToPicker: React.FC<AgentTalkingToPickerProps> = ({
  entries,
  selectedSlug,
  onSelect,
  onOpen,
  onOpenMemory,
  onClearMemory,
  container,
  className,
}) => {
  const selected = entries.find((entry) => entry.slug === selectedSlug) ?? entries[0];
  if (!selected) return null;
  // Copilot keeps no memory, and neither does an agent whose toggle is off, so
  // neither offers a file to open or clear.
  const memorySlug =
    selected.kind === "custom" && selected.agent.memoryEnabled ? selected.slug : null;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          aria-label={`Talking to ${selected.name}`}
          title={`Talking to ${selected.name}`}
          // A fixed height, so swapping Copilot for a named agent never nudges
          // the header. The padding and gap are the session tab's, so the agent
          // and the tab below it share one leading column. `max-w-full` plus
          // `min-w-0` keep a long name truncating inside a narrow pane whatever
          // the host row is.
          className={cn(
            "tw-h-7 tw-min-w-0 tw-max-w-full tw-justify-start tw-gap-1.5 tw-px-2 tw-text-muted",
            className
          )}
        >
          <AgentGlyph icon={selected.icon} />
          <span className="tw-min-w-0 tw-truncate tw-text-ui-small tw-font-medium">
            {selected.name}
          </span>
          <ChevronDown className="tw-size-4 tw-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        container={container ?? undefined}
        className="tw-max-h-64 tw-w-64 tw-overflow-y-auto"
      >
        {entries.map((entry) => (
          <DropdownMenuItem key={entry.slug} onSelect={() => onSelect(entry.slug)}>
            <AgentGlyph icon={entry.icon} />
            <div className="tw-min-w-0 tw-flex-1">
              <div className="tw-truncate tw-text-ui-small tw-text-normal">{entry.name}</div>
              {entry.description && (
                <div className="tw-truncate tw-text-xs tw-text-muted" title={entry.description}>
                  {entry.description}
                </div>
              )}
            </div>
            {entry.slug === selected.slug && (
              <Check className="tw-size-4 tw-shrink-0 tw-text-accent" />
            )}
          </DropdownMenuItem>
        ))}
        {memorySlug && (
          <>
            <DropdownMenuLabel className="tw-text-muted">{selected.name}</DropdownMenuLabel>
            <DropdownMenuItem
              className="tw-gap-2.5 tw-text-ui-small"
              onSelect={() => onOpenMemory?.(memorySlug)}
            >
              <BookOpen className="tw-size-3.5" aria-hidden="true" />
              Open memory
            </DropdownMenuItem>
            <DropdownMenuItem
              className="tw-gap-2.5 tw-text-ui-small"
              onSelect={() => onClearMemory?.(memorySlug)}
            >
              <Eraser className="tw-size-3.5" aria-hidden="true" />
              Clear memory
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

AgentTalkingToPicker.displayName = "AgentTalkingToPicker";
