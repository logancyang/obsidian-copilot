import React, { useId } from "react";
import { ChevronRight } from "lucide-react";
import { MiyoLogo } from "@/miyo/ui/MiyoLogo";
import type { MiyoNote } from "@/miyo/agentMode/miyoSearchRun";
import { pluralize } from "@/agentMode/ui/toolSummaries";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { cn } from "@/lib/utils";

export interface MiyoSearchCardProps {
  status: AgentToolStatus;
  query: string | null;
  notes: readonly MiyoNote[] | null;
  error?: string | null;
  open: boolean;
  onToggle: () => void;
  onOpenNote: (path: string) => void;
}

export const MiyoSearchCard: React.FC<MiyoSearchCardProps> = ({
  status,
  query,
  notes,
  error,
  open,
  onToggle,
  onOpenNote,
}) => {
  const listId = useId();
  const running = status === "pending" || status === "in_progress";
  const failed = status === "failed";
  const stopped = status === "cancelled";
  const label = running
    ? "Searching with Miyo"
    : failed
      ? "Miyo search failed"
      : stopped
        ? "Miyo search stopped"
        : "Searched with Miyo";
  const outcome =
    running || failed || stopped || notes === null
      ? null
      : notes.length === 0
        ? "No notes"
        : pluralize(notes.length, "note");
  const listed =
    !running && !failed && !stopped && notes !== null && notes.length > 0 ? notes : null;
  const expandable = listed !== null;

  return (
    <div
      className={cn(
        "tw-my-1 tw-w-full tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-bg-secondary tw-text-sm",
        failed ? "tw-border-border" : "tw-border-interactive-accent/40"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-w-full tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1 tw-px-2 tw-py-1.5",
          expandable && "tw-cursor-pointer hover:tw-bg-modifier-hover"
        )}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? listId : undefined}
        onClick={expandable ? onToggle : undefined}
        onKeyDown={
          expandable
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onToggle();
              }
            : undefined
        }
      >
        <MiyoLogo className="tw-size-4 tw-text-normal" />
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-baseline tw-gap-1.5 tw-overflow-hidden">
          <span
            className={cn(
              "tw-shrink-0 tw-font-medium",
              running
                ? "copilot-shimmer-text motion-reduce:tw-animate-none"
                : failed
                  ? "tw-text-error"
                  : "tw-text-normal"
            )}
          >
            {label}
          </span>
          {query ? <span className="tw-min-w-0 tw-truncate tw-text-muted">“{query}”</span> : null}
        </div>
        {outcome ? <span className="tw-shrink-0 tw-text-xs tw-text-muted">{outcome}</span> : null}
        {expandable ? (
          <ChevronRight
            className={cn(
              "tw-size-3 tw-shrink-0 tw-text-muted tw-transition-transform",
              open && "tw-rotate-90"
            )}
          />
        ) : null}
        {error ? (
          <div className="tw-line-clamp-2 tw-basis-full tw-pl-6 tw-text-xs tw-text-muted">
            {error}
          </div>
        ) : null}
      </div>
      {listed && open ? (
        <ul
          id={listId}
          className="copilot-divider-t tw-m-0 tw-max-h-28 tw-list-none tw-overflow-y-auto tw-p-0"
        >
          {listed.map((note) => (
            <li key={`${note.folder ?? ""}/${note.path}`}>
              <MiyoNoteRow note={note} onOpen={onOpenNote} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

interface MiyoNoteRowProps {
  note: MiyoNote;
  onOpen: (path: string) => void;
}

const MiyoNoteRow: React.FC<MiyoNoteRowProps> = ({ note, onOpen }) => {
  const separator = note.path.lastIndexOf("/");
  const name = note.path.slice(separator + 1).replace(/\.md$/, "");
  const location = [note.folder, separator === -1 ? undefined : note.path.slice(0, separator)]
    .filter(Boolean)
    .join("/");
  const content = (
    <>
      <span className="tw-min-w-0 tw-truncate">{name}</span>
      {location ? (
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-xs tw-text-muted">
          {location}
        </span>
      ) : null}
    </>
  );
  const rowClass =
    "tw-flex tw-w-full tw-items-baseline tw-justify-start tw-gap-2 tw-px-2 tw-py-1 tw-pl-8 tw-text-sm";

  // Notes from other Miyo folders live outside the vault, so Obsidian cannot open them.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/735
  if (note.folder !== undefined) {
    return (
      <div title={`${note.folder}/${note.path}`} className={cn(rowClass, "tw-text-muted")}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      title={note.path}
      onClick={() => onOpen(note.path)}
      className={cn(
        rowClass,
        "tw-h-auto tw-cursor-pointer !tw-rounded-none tw-border-none !tw-bg-transparent tw-text-left tw-text-normal !tw-shadow-none hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
      )}
    >
      {content}
    </button>
  );
};
