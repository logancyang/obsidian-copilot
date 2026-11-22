import { agentTitle } from "@/agents/agentTitle";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import {
  AgentFace,
  FACE_BADGE_CLASS,
  LOCKED_FACE_CLASS,
  LockBadge,
  ROSTER_SELECTED_FACE_CLASS,
} from "@/agents/ui/AgentFace";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { NO_OBSIDIAN_TOOLTIP } from "@/connectors/ui/ConnectorRow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { computeVisibleTabIndices } from "@/components/ui/tabOverflow";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Lock, Plus, Settings } from "lucide-react";
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
  needsSetup?: Pick<ReadonlySet<string>, "has">;
}

export interface LockedRoster {
  onOpen: (slug: string) => void;
  note: React.ReactNode;
}

// A cell is wide enough for a four-character Chinese name, and the fit calculation must count the widths the classes draw.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/588
const CELL_PX = 50;
const CELL_WIDTH_CLASS = "tw-w-[50px]";
const GAP_PX = 6;
const ROW_GAP_CLASS = "tw-gap-1.5";

const COPILOT_NAME = "Copilot";
const COPILOT_TITLE = "Starts fresh every chat.";
const ROSTER_QUESTION = "Who do you want to talk to?";

const CIRCLE_CLASS =
  "tw-flex tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-primary";
const ROW_CIRCLE_CLASS = cn(CIRCLE_CLASS, "tw-size-[42px]");
// In a window up to 640px tall the picked face shrinks so the row and the chat input stay in view, even on a project home.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/588
const SHORT_WINDOW_PICKED_FACE_CLASS = "[@media(max-height:640px)]:tw-size-16";

export function AgentRoster({
  agents,
  selectedSlug,
  onSelect,
  emptyHero,
  newAgentButton,
  onOpenProfile,
  locked,
  needsSetup,
}: AgentRosterProps): React.ReactElement {
  const labelId = useId();
  if (agents.length === 0 && !newAgentButton) return <>{emptyHero}</>;
  // Locked agents can't be picked for a chat, so Copilot stays selected and a face opens its locked profile.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
  const selected = locked ? null : (agents.find((agent) => agent.slug === selectedSlug) ?? null);
  const select = (slug: string | null) => {
    if (slug !== (selected?.slug ?? null)) onSelect(slug);
  };
  // An agent whose model can't run on this device is locked too, and its face opens its profile to fix that.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/962
  const lockOf = (slug: string): AgentLock | undefined =>
    locked ? "license" : needsSetup?.has(slug) ? "setup" : undefined;
  const choose = (slug: string) => {
    const lock = lockOf(slug);
    if (lock === "license") locked?.onOpen(slug);
    else if (lock === "setup") onOpenProfile?.(slug);
    else select(slug);
  };
  const row = (
    <FaceRow
      agents={agents}
      selected={selected}
      onSelect={select}
      onChoose={choose}
      lockOf={lockOf}
      newAgentButton={newAgentButton}
      labelledBy={labelId}
    />
  );

  // With no agents yet, the home keeps its greeting and offers "+" next to Copilot.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  if (agents.length === 0) {
    return (
      <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-center">
        <div id={labelId} className="tw-min-w-0 tw-max-w-full">
          {emptyHero}
        </div>
        {row}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-center">
      <PickedAgent agent={selected} onOpenProfile={onOpenProfile} />
      {row}
      {/* The picked agent above already says who the chat is with, so only screen readers get the question, through a
      hidden label: an aria-label would make Obsidian show it as the whole row's tooltip.
      https://github.com/Brevilabs/obsidian-copilot-private/issues/978 */}
      <span id={labelId} hidden>
        {ROSTER_QUESTION}
      </span>
      {locked && (
        <div className="tw-mt-2 tw-max-w-80 tw-text-balance tw-text-center tw-text-ui-small tw-text-muted">
          {locked.note}
        </div>
      )}
    </div>
  );
}

interface PickedAgentProps {
  agent: RosterAgent | null;
  onOpenProfile?: (slug: string) => void;
}

function PickedAgent({ agent, onOpenProfile }: PickedAgentProps) {
  const title = agent ? agentTitle(agent) : COPILOT_TITLE;
  return (
    <div className="tw-flex tw-w-full tw-min-w-0 tw-flex-col tw-items-center tw-text-center">
      {agent && onOpenProfile ? (
        <ProfileFaceButton agent={agent} onOpen={() => onOpenProfile(agent.slug)} />
      ) : agent ? (
        <AgentFace src={agent.faceSrc} size="xxl" className={SHORT_WINDOW_PICKED_FACE_CLASS} />
      ) : (
        <span
          className={cn(
            CIRCLE_CLASS,
            "tw-size-[88px] tw-text-normal",
            SHORT_WINDOW_PICKED_FACE_CLASS
          )}
        >
          <CopilotBrandIcon className="tw-size-11 [@media(max-height:640px)]:tw-size-8" />
        </span>
      )}
      {/* The pressed face in the row already names the picked agent, so a screen reader hears it once.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/588 */}
      <div
        aria-hidden="true"
        className="tw-mt-2 tw-max-w-full tw-truncate tw-text-xl tw-font-semibold tw-text-normal"
      >
        {agent?.name ?? COPILOT_NAME}
      </div>
      <div className="tw-line-clamp-2 tw-min-w-0 tw-max-w-full tw-text-ui-small tw-text-muted">
        {title}
      </div>
    </div>
  );
}

interface ProfileFaceButtonProps {
  agent: RosterAgent;
  onOpen: () => void;
}

const GEAR_BRIGHTER_ON_HOVER_OR_FOCUS =
  "[:hover>&]:tw-text-normal [:focus-visible>&]:tw-text-normal";

// Obsidian draws buttons as squircles, so the round face asks for a round focus ring.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/588
const ROUND_CORNERS = "[corner-shape:round]";

function ProfileFaceButton({ agent, onOpen }: ProfileFaceButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Open ${agent.name}'s profile`}
          onClick={onOpen}
          className={cn(
            "clickable-icon tw-relative tw-h-auto tw-cursor-pointer tw-rounded-full tw-bg-transparent tw-p-0 tw-shadow-none hover:tw-bg-transparent motion-safe:tw-transition-transform motion-safe:tw-duration-150 motion-safe:tw-ease-out motion-safe:hover:tw-scale-105",
            ROUND_CORNERS,
            NO_OBSIDIAN_TOOLTIP
          )}
        >
          <AgentFace src={agent.faceSrc} size="xxl" className={SHORT_WINDOW_PICKED_FACE_CLASS} />
          <span className={cn(FACE_BADGE_CLASS, "tw-size-6", GEAR_BRIGHTER_ON_HOVER_OR_FOCUS)}>
            <Settings className="tw-size-3.5" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Open profile</TooltipContent>
    </Tooltip>
  );
}

type AgentLock = "license" | "setup";

const LOCK_LABEL: Record<AgentLock, string> = {
  license: "Supporter preview",
  setup: "Needs setup",
};

interface FaceRowProps {
  agents: readonly RosterAgent[];
  selected: RosterAgent | null;
  onSelect: (slug: string | null) => void;
  onChoose: (slug: string) => void;
  lockOf: (slug: string) => AgentLock | undefined;
  newAgentButton?: React.ReactNode;
  labelledBy: string;
}

function FaceRow({
  agents,
  selected,
  onSelect,
  onChoose,
  lockOf,
  newAgentButton,
  labelledBy,
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
      className={cn("tw-mt-3 tw-flex tw-w-full tw-justify-center", ROW_GAP_CLASS)}
    >
      <RosterCell label={COPILOT_NAME} selected={!selected} onClick={() => onSelect(null)}>
        <span
          className={cn(
            ROW_CIRCLE_CLASS,
            "tw-text-normal",
            !selected && ROSTER_SELECTED_FACE_CLASS
          )}
        >
          <CopilotBrandIcon className="tw-size-6" />
        </span>
      </RosterCell>
      {visibleIndices.map((index) => (
        <AgentCell
          key={agents[index].slug}
          agent={agents[index]}
          selected={agents[index] === selected}
          lock={lockOf(agents[index].slug)}
          onSelect={onChoose}
        />
      ))}
      {overflow.length > 0 && (
        <MoreAgentsMenu agents={overflow} lockOf={lockOf} onSelect={onChoose} />
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
        "clickable-icon tw-flex tw-h-auto tw-shrink-0 tw-flex-col tw-items-center tw-gap-1 tw-rounded-md tw-bg-transparent tw-px-0 tw-pb-0.5 tw-pt-1 tw-opacity-100 tw-shadow-none",
        CELL_WIDTH_CLASS,
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
  lock: AgentLock | undefined;
  onSelect: (slug: string) => void;
}

function AgentCell({ agent, selected, lock, onSelect }: AgentCellProps) {
  const title = agentTitle(agent);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RosterCell
          label={agent.name}
          aria-label={lock ? `${agent.name} · ${LOCK_LABEL[lock]}` : undefined}
          selected={lock ? undefined : selected}
          onClick={() => onSelect(agent.slug)}
        >
          <AgentFace src={agent.faceSrc} size="roster" selected={selected} locked={!!lock} />
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
  lockOf: (slug: string) => AgentLock | undefined;
  onSelect: (slug: string) => void;
}

function MoreAgentsMenu({ agents, lockOf, onSelect }: MoreAgentsMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <RosterCell label="More" aria-label={`Show ${agents.length} more teammates`}>
          <span className={cn(ROW_CIRCLE_CLASS, "tw-text-ui-small tw-font-semibold tw-text-muted")}>
            +{agents.length}
          </span>
        </RosterCell>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="tw-max-h-72 tw-w-56 tw-overflow-y-auto">
        {agents.map((agent) => {
          const locked = !!lockOf(agent.slug);
          return (
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
          );
        })}
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
      aria-label={locked ? "New teammate · Supporter preview" : "New teammate"}
      onClick={onClick}
    >
      <span
        className={cn(
          ROW_CIRCLE_CLASS,
          "tw-relative tw-border-[1.5px] tw-border-dashed tw-bg-transparent",
          emphasized
            ? "tw-border-[color:var(--text-muted)] tw-text-normal"
            : "tw-border-border tw-text-muted"
        )}
      >
        <Plus className="tw-size-5" />
        {locked && <LockBadge />}
      </span>
    </RosterCell>
  );
}
