import React from "react";
import { MiyoLogo } from "@/miyo/ui/MiyoLogo";
import type { MiyoNote } from "@/miyo/agentMode/miyoSearchRun";
import { pluralize } from "@/agentMode/ui/toolSummaries";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { ToolCard, ToolCardRowButton, toolCardRowClass } from "@/agentMode/ui/ToolCard";
import { cn } from "@/lib/utils";
import { openLinkClickProps, type OpenPane } from "@/utils/openVaultPath";

export interface MiyoSearchCardProps {
  status: AgentToolStatus;
  query: string | null;
  notes: readonly MiyoNote[] | null;
  error?: string | null;
  open: boolean;
  onToggle: () => void;
  onOpenNote: (path: string, pane: OpenPane) => void;
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

  return (
    <ToolCard
      icon={MiyoLogo}
      label={label}
      state={running ? "running" : failed ? "failed" : undefined}
      quote={query}
      outcome={outcome}
      detail={error}
      open={open}
      onToggle={listed ? onToggle : undefined}
    >
      <ul className="tw-m-0 tw-max-h-28 tw-list-none tw-overflow-y-auto tw-p-0">
        {listed?.map((note) => (
          <li key={`${note.folder ?? ""}/${note.path}`}>
            <MiyoNoteRow note={note} onOpen={onOpenNote} />
          </li>
        ))}
      </ul>
    </ToolCard>
  );
};

interface MiyoNoteRowProps {
  note: MiyoNote;
  onOpen: (path: string, pane: OpenPane) => void;
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

  // Notes from other Miyo folders live outside the vault, so Obsidian cannot open them.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/735
  if (note.folder !== undefined) {
    return (
      <div title={`${note.folder}/${note.path}`} className={cn(toolCardRowClass, "tw-text-muted")}>
        {content}
      </div>
    );
  }
  return (
    <ToolCardRowButton title={note.path} {...openLinkClickProps((pane) => onOpen(note.path, pane))}>
      {content}
    </ToolCardRowButton>
  );
};
