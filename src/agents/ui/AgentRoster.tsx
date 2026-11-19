import { agentTitle } from "@/agents/agentTitle";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import {
  AgentFace,
  LOCKED_FACE_CLASS,
  LockBadge,
  SELECTED_FACE_CLASS,
} from "@/agents/ui/AgentFace";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { computeVisibleTabIndices } from "@/components/ui/tabOverflow";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChevronRight, Lock, Plus } from "lucide-react";
import React, { useId, useLayoutEffect, useRef, useState } from "react";

export type RosterAgent = Pick<CustomAgent, "slug" | "name" | "title" | "instruction" | "faceSrc">;

export interface AgentRosterProps {
  agents: readonly RosterAgent[];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
  emptyHero: React.ReactNode;
  newAgentButton?: React.ReactNode;
  onOpenProfile?: (slug: string) => void;
  locked?: LockedRoster;
}

export interface LockedRoster {
  onOpen: (slug: string) => void;
  note: React.ReactNode;
}

const CELL_PX = 54;
const GAP_PX = 6;

const CIRCLE_CLASS =
  "tw-flex tw-size-[54px] tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-primary";

export function AgentRoster({
  agents,
  selectedSlug,
  onSelect,
  emptyHero,
  newAgentButton,
  onOpenProfile,
  locked,
}: AgentRosterProps): React.ReactElement {
  const headingId = useId();
  if (agents.length === 0 && !newAgentButton) return <>{emptyHero}</>;
  // Locked agents can't be picked for a chat, so Copilot stays selected and a face opens its locked profile.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
  const selected = locked ? null : (agents.find((agent) => agent.slug === selectedSlug) ?? null);
  const select = (slug: string | null) => {
    if (slug !== (selected?.slug ?? null)) onSelect(slug);
  };
  const row = (
    <FaceRow
      agents={agents}
      selected={selected}
      onSelect={select}
      newAgentButton={newAgentButton}
      labelledBy={headingId}
      onOpenLocked={locked?.onOpen}
    />
  );

  // With no agents yet, the home keeps its greeting and offers "+" next to Copilot.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  if (agents.length === 0) {
    return (
      <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-center">
        <div id={headingId} className="tw-min-w-0 tw-max-w-full">
          {emptyHero}
        </div>
        {row}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-center">
      <div
        id={headingId}
        role="heading"
        aria-level={2}
        className="tw-text-balance tw-text-center tw-text-3xl tw-font-[330] tw-text-normal"
      >
        Who do you want to talk to?
      </div>
      {row}
      {locked ? (
        <div className="tw-mt-2 tw-max-w-80 tw-text-balance tw-text-center tw-text-ui-small tw-text-muted">
          {locked.note}
        </div>
      ) : (
        <div className="tw-mt-2 tw-flex tw-h-5 tw-min-w-0 tw-max-w-full tw-items-center tw-justify-center tw-gap-1.5 tw-text-ui-small tw-text-muted">
          <span className="tw-min-w-0 tw-truncate">
            {selected ? agentTitle(selected) : "No agent, no memory"}
          </span>
          {selected && onOpenProfile && (
            <>
              <span aria-hidden="true" className="tw-text-faint">
                ·
              </span>
              <button
                type="button"
                onClick={() => onOpenProfile(selected.slug)}
                className="clickable-icon tw-h-auto tw-shrink-0 tw-gap-px tw-bg-transparent tw-p-0 tw-text-ui-small tw-text-muted tw-underline tw-decoration-[color:var(--text-faint)] tw-underline-offset-2 tw-shadow-none"
              >
                Profile
                <ChevronRight className="tw-size-3" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface FaceRowProps {
  agents: readonly RosterAgent[];
  selected: RosterAgent | null;
  onSelect: (slug: string | null) => void;
  newAgentButton?: React.ReactNode;
  labelledBy: string;
  onOpenLocked?: (slug: string) => void;
}

function FaceRow({
  agents,
  selected,
  onSelect,
  newAgentButton,
  labelledBy,
  onOpenLocked,
}: FaceRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => setWidth(row.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // Copilot and the new-agent button never move into the menu, and the selected agent always stays in the row.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
  const fixedCells = newAgentButton ? 2 : 1;
  const visibleIndices = computeVisibleTabIndices({
    widths: agents.map(() => CELL_PX),
    selectedIndex: selected ? agents.indexOf(selected) : -1,
    available: width - fixedCells * (CELL_PX + GAP_PX),
    gap: GAP_PX,
    overflowWidth: CELL_PX,
  });
  const overflow = agents.filter((_, index) => !visibleIndices.includes(index));

  return (
    <div
      ref={rowRef}
      role="group"
      aria-labelledby={labelledBy}
      className="tw-mt-3 tw-flex tw-w-full tw-justify-center tw-gap-1.5"
    >
      <RosterCell label="Copilot" selected={!selected} onClick={() => onSelect(null)}>
        <span className={cn(CIRCLE_CLASS, "tw-text-normal", !selected && SELECTED_FACE_CLASS)}>
          <CopilotBrandIcon className="tw-size-7" />
        </span>
      </RosterCell>
      {visibleIndices.map((index) => (
        <AgentCell
          key={agents[index].slug}
          agent={agents[index]}
          selected={agents[index] === selected}
          locked={!!onOpenLocked}
          onSelect={onOpenLocked ?? onSelect}
        />
      ))}
      {overflow.length > 0 && (
        <MoreAgentsMenu
          agents={overflow}
          locked={!!onOpenLocked}
          onSelect={onOpenLocked ?? onSelect}
        />
      )}
      {newAgentButton}
    </div>
  );
}

interface RosterCellProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  selected?: boolean;
}

const RosterCell = React.forwardRef<HTMLButtonElement, RosterCellProps>(
  ({ label, selected, children, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      {...props}
      className={cn(
        "clickable-icon tw-flex tw-h-auto tw-w-[54px] tw-shrink-0 tw-flex-col tw-items-center tw-gap-1 tw-rounded-md tw-bg-transparent tw-px-0 tw-pb-0.5 tw-pt-1 tw-opacity-100 tw-shadow-none",
        className
      )}
    >
      {children}
      <span
        className={cn(
          "tw-max-w-full tw-truncate tw-text-ui-smaller",
          selected ? "tw-font-semibold tw-text-normal" : "tw-text-muted"
        )}
      >
        {label}
      </span>
    </button>
  )
);
RosterCell.displayName = "RosterCell";

interface AgentCellProps {
  agent: RosterAgent;
  selected: boolean;
  locked: boolean;
  onSelect: (slug: string) => void;
}

function AgentCell({ agent, selected, locked, onSelect }: AgentCellProps) {
  const title = agentTitle(agent);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RosterCell
          label={agent.name}
          aria-label={locked ? `${agent.name} · Supporter preview` : undefined}
          selected={locked ? undefined : selected}
          onClick={() => onSelect(agent.slug)}
        >
          <AgentFace src={agent.faceSrc} size="roster" selected={selected} locked={locked} />
        </RosterCell>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="tw-max-w-64 tw-text-center">
        <div className="tw-font-semibold">{agent.name}</div>
        {title && <div className="tw-text-muted">{title}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

interface MoreAgentsMenuProps {
  agents: readonly RosterAgent[];
  locked: boolean;
  onSelect: (slug: string) => void;
}

function MoreAgentsMenu({ agents, locked, onSelect }: MoreAgentsMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <RosterCell label="More" aria-label={`Show ${agents.length} more agents`}>
          <span className={cn(CIRCLE_CLASS, "tw-text-ui-small tw-font-semibold tw-text-muted")}>
            +{agents.length}
          </span>
        </RosterCell>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="tw-max-h-72 tw-w-56 tw-overflow-y-auto">
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.slug}
            onSelect={() => onSelect(agent.slug)}
            className="tw-gap-2"
          >
            <AgentFace src={agent.faceSrc} size="s" className={cn(locked && LOCKED_FACE_CLASS)} />
            <span className="tw-min-w-0 tw-shrink tw-truncate tw-text-normal">{agent.name}</span>
            <span className="tw-ml-auto tw-min-w-0 tw-max-w-[55%] tw-truncate tw-text-ui-smaller tw-text-muted">
              {agentTitle(agent)}
            </span>
            {locked && (
              <Lock aria-label="Locked" className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface NewAgentButtonProps {
  onClick: () => void;
  emphasized?: boolean;
  locked?: boolean;
}

export function NewAgentButton({
  onClick,
  emphasized,
  locked,
}: NewAgentButtonProps): React.ReactElement {
  return (
    <RosterCell
      label="New"
      aria-label={locked ? "New agent · Supporter preview" : "New agent"}
      onClick={onClick}
    >
      <span
        className={cn(
          CIRCLE_CLASS,
          "tw-relative tw-border-[1.5px] tw-border-dashed tw-bg-transparent",
          emphasized
            ? "tw-border-[color:var(--text-muted)] tw-text-normal"
            : "tw-border-border tw-text-muted"
        )}
      >
        <Plus className="tw-size-6" />
        {locked && <LockBadge />}
      </span>
    </RosterCell>
  );
}
