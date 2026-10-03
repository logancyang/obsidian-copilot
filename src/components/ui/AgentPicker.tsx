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

export interface AgentPickerRow {
  slug: string;
  name: string;
  icon: string;
  description: string;
  modelKey: string | null;
  effort: string | null;
}

export interface AgentPickerSection {
  rows: readonly AgentPickerRow[];
  selectedSlug: string;
  onSelect: (row: AgentPickerRow) => void;
  onOpen?: () => void;
}

const AGENT_SEARCH_THRESHOLD = 6;

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
  rows: readonly AgentPickerRow[];
  selectedSlug: string;
  highlightSlug?: string | null;
  search?: { query: string; onChange: (query: string) => void };
  onPick: (row: AgentPickerRow) => void;
  onHighlight?: (row: AgentPickerRow) => void;
}

export const AgentPickerList: React.FC<AgentPickerListProps> = ({
  rows,
  onHighlight,
  selectedSlug,
  highlightSlug,
  search,
  onPick,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
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
  defaultOpen?: boolean;
}

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
          className="tw-min-w-0 tw-max-w-full tw-justify-start tw-truncate tw-text-muted"
          title="Agent"
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
            <AgentGlyph icon={current.icon} />
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
