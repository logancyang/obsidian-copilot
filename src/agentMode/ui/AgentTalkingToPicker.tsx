import type { AgentEntry } from "@/agents/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
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
  container,
  className,
}) => {
  const selected = entries.find((entry) => entry.slug === selectedSlug) ?? entries[0];
  if (!selected) return null;

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
          // the header; min-w-0 + truncate keep a long name inside a narrow pane.
          className={cn("tw-h-7 tw-min-w-0 tw-justify-start tw-text-muted", className)}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

AgentTalkingToPicker.displayName = "AgentTalkingToPicker";

/**
 * An agent's emoji in a fixed box, so rows and the trigger keep one leading
 * width whether the agent set an icon or not.
 */
function AgentGlyph({ icon }: { icon: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center tw-text-xs"
    >
      {icon}
    </span>
  );
}
