import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AgentGlyph } from "@/components/ui/AgentGlyph";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  HIGHLIGHT_ROW_BG,
  ROW_CLASS,
  SELECTED_ROW_BG,
  SELECTED_ROW_NAME,
} from "@/components/ui/picker-rows";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";

/** One agent the chat can be held with, and what picking it selects. */
export interface AgentPickerRow {
  slug: string;
  name: string;
  /** Emoji or letter; empty for an agent that set none. */
  icon: string;
  description: string;
  /**
   * Model row this agent pins, as a `getModelKeyFromModel` key, or null when it
   * pins none (or pins one the model picker is not offering) and the selection
   * should be left where the user put it.
   */
  modelKey: string | null;
  /** Effort this agent pins, or null to leave the current effort alone. */
  effort: string | null;
}

/** Who the chat is held with, and how picking someone else is reported. */
export interface AgentPickerSection {
  /** The built-in Copilot first, then every agent on disk. */
  rows: readonly AgentPickerRow[];
  selectedSlug: string;
  /**
   * Talk to this agent from the next chat on. The row carries the agent's pins,
   * so the caller applies them to the model picker in the same step
   * (`designdocs/CUSTOM_AGENTS.md` §3).
   */
  onSelect: (row: AgentPickerRow) => void;
  /** Called as the popover opens, so an agent created a moment ago is listed. */
  onOpen?: () => void;
}

/**
 * Roster size past which the list grows a search field. A team of this many
 * still reads at a glance; beyond it, scanning costs more than typing
 * (`designdocs/CUSTOM_AGENTS.md` §3).
 */
const AGENT_SEARCH_THRESHOLD = 6;

/**
 * The agents whose name or description matches `query`, case-insensitively.
 * Description is searched alongside name because it is what one agent in a team
 * is told apart from another by, and it is what the user was reading when they
 * decided to search.
 */
export function filterAgentRows(
  rows: readonly AgentPickerRow[],
  query: string
): readonly AgentPickerRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle)
  );
}

interface AgentPickerListProps {
  /** Rows to draw, already narrowed by {@link filterAgentRows}. */
  rows: readonly AgentPickerRow[];
  selectedSlug: string;
  /** Row the keyboard is on, drawn as hovered so Enter's target is visible. */
  highlightSlug?: string | null;
  /** Search field above the rows; present only past {@link AGENT_SEARCH_THRESHOLD}. */
  search?: { query: string; onChange: (query: string) => void };
  onPick: (row: AgentPickerRow) => void;
  /**
   * The pointer moved onto a row. The keyboard highlight follows it, the way a
   * menu's does, so hovering and arrowing never paint two rows at once.
   */
  onHighlight?: (row: AgentPickerRow) => void;
}

/**
 * The roster itself: everyone the chat could be held with, each with the glyph,
 * name, and description the choice is made on, the current one tinted. Pure
 * presentation — the caller owns the query, the highlight, and what picking a
 * row does.
 */
export const AgentPickerList: React.FC<AgentPickerListProps> = ({
  rows,
  onHighlight,
  selectedSlug,
  highlightSlug,
  search,
  onPick,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the highlighted row in view: past six agents the list scrolls, so an
  // arrow press that moved the highlight below the fold would read as dead, and
  // a list opened on an agent far down it would open on strangers.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlightSlug]);
  return (
    <>
      {search && (
        <div className="tw-border-0 tw-border-b tw-border-solid tw-border-border tw-p-1">
          <SearchBar
            value={search.query}
            onChange={search.onChange}
            placeholder="Search agents..."
            inputClassName="!tw-h-7"
          />
        </div>
      )}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Agent"
        className="tw-max-h-64 tw-overflow-y-auto tw-py-1"
      >
        {rows.length === 0 ? (
          <div className="tw-px-3 tw-py-1.5 tw-text-xs tw-text-muted">No matching agents</div>
        ) : (
          rows.map((row) => {
            const isSelected = row.slug === selectedSlug;
            const isHighlight = row.slug === highlightSlug;
            return (
              <div
                key={row.slug}
                role="option"
                aria-selected={isSelected}
                data-highlighted={isHighlight || undefined}
                // Top-aligned: a description that wraps must not drag the agent's
                // face down to the middle of the block its name heads.
                className={cn(
                  ROW_CLASS,
                  "tw-items-start",
                  isSelected ? SELECTED_ROW_BG : isHighlight && HIGHLIGHT_ROW_BG
                )}
                onPointerMove={() => {
                  if (!isHighlight) onHighlight?.(row);
                }}
                onClick={() => onPick(row)}
              >
                <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
                  <AgentGlyph icon={row.icon} className="tw-h-5" />
                  <div className="tw-min-w-0">
                    <div
                      className={cn("tw-truncate tw-text-normal", isSelected && SELECTED_ROW_NAME)}
                    >
                      {row.name}
                    </div>
                    {row.description && (
                      // Wrapped, not truncated: the description is the whole basis
                      // on which the user picks one agent over another, and at this
                      // width a one-line clamp cut every real description mid-word.
                      <div
                        className="tw-line-clamp-2 tw-text-xs tw-text-muted"
                        title={row.description}
                      >
                        {row.description}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
};

AgentPickerList.displayName = "AgentPickerList";

export interface AgentPickerProps {
  section: AgentPickerSection;
  /** Opens the popover on mount, so a story can show the roster it holds. */
  defaultOpen?: boolean;
}

/**
 * The composer's agent control: the current agent's glyph and name, opening the
 * whole roster in one click (`designdocs/CUSTOM_AGENTS.md` §3). It sits between
 * the Add Context button and the model picker and carries the agent alone — the
 * model picker stays the model picker, so switching agent and switching model
 * are each one click from the composer rather than three.
 */
export function AgentPicker({ section, defaultOpen }: AgentPickerProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [query, setQuery] = useState("");
  const [highlightSlug, setHighlightSlug] = useState<string | null>(section.selectedSlug);

  const current = section.rows.find((row) => row.slug === section.selectedSlug) ?? section.rows[0];
  const visible = useMemo(() => filterAgentRows(section.rows, query), [section.rows, query]);
  const highlightIndex = Math.max(
    0,
    visible.findIndex((row) => row.slug === highlightSlug)
  );

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // The roster is read from the vault, so an agent created in Settings a
      // moment ago is listed without waiting for a reload.
      section.onOpen?.();
      setQuery("");
      setHighlightSlug(section.selectedSlug);
    }
    setOpen(next);
  };

  const choose = (row: AgentPickerRow) => {
    section.onSelect(row);
    setOpen(false);
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        setHighlightSlug(visible[(highlightIndex + 1) % visible.length].slug);
        break;
      case "ArrowUp":
        setHighlightSlug(visible[(highlightIndex - 1 + visible.length) % visible.length].slug);
        break;
      case "Enter":
        choose(visible[highlightIndex]);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          // Truncating is the trigger's own business: it shares the composer's
          // row with the model picker, and a long agent name must give way there
          // rather than push the model off the row.
          className="tw-min-w-0 tw-max-w-full tw-justify-start tw-truncate tw-text-muted"
          title="Agent"
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
            <AgentGlyph icon={current.icon} />
            {/* Typed like the model picker's own label, so the two triggers share
                a baseline and a height on the composer's row. */}
            <span className="tw-truncate tw-text-sm">{current.name}</span>
          </div>
          <ChevronDown className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="tw-w-[300px] tw-overflow-hidden tw-p-0"
        align="start"
        side="top"
        sideOffset={4}
        collisionPadding={8}
        onKeyDown={handleListKeyDown}
      >
        <AgentPickerList
          rows={visible}
          selectedSlug={section.selectedSlug}
          highlightSlug={highlightSlug}
          search={
            section.rows.length > AGENT_SEARCH_THRESHOLD ? { query, onChange: setQuery } : undefined
          }
          onPick={choose}
          onHighlight={(row) => setHighlightSlug(row.slug)}
        />
      </PopoverContent>
    </Popover>
  );
}
