import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { AgentGlyph } from "@/components/ui/AgentGlyph";
import { BareButton } from "@/components/ui/bare-button";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { partitionOverflow } from "@/lib/partitionOverflow";
import { Pencil, Plus } from "lucide-react";
import React, { useId, useLayoutEffect, useRef, useState } from "react";

export interface AgentPickerRow {
  slug: string;
  name: string;
  avatarSrc: string | null;
  description: string;
}

export interface AgentPickerSection {
  rows: readonly AgentPickerRow[];
  selectedSlug: string;
  onSelect: (row: AgentPickerRow) => void;
}

export interface AgentSpotlightProps {
  section: AgentPickerSection;
  onCreateAgent: () => void;
  onOpenAgent: (row: AgentPickerRow) => void;
}

function builtinFallback(builtin: boolean, className: string): React.ReactNode {
  return builtin ? <CopilotBrandIcon className={className} /> : undefined;
}

export function countInlineAgents(slots: number, agentCount: number): number {
  if (agentCount <= slots - 2) return agentCount;
  return Math.max(0, slots - 3);
}

export const AgentSpotlight: React.FC<AgentSpotlightProps> = ({
  section,
  onCreateAgent,
  onOpenAgent,
}) => {
  const current = section.rows.find((row) => row.slug === section.selectedSlug) ?? section.rows[0];
  const isBuiltin = current === section.rows[0];
  const headingId = useId();
  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-center tw-gap-4">
      <div
        id={headingId}
        role="heading"
        aria-level={2}
        className="tw-text-balance tw-text-center tw-text-2xl tw-font-[330] tw-text-normal"
      >
        Who do you want to talk to?
      </div>
      {current && (
        <div className="tw-flex tw-w-full tw-min-w-0 tw-flex-col tw-items-center tw-gap-1.5 tw-text-center">
          {isBuiltin ? (
            <AgentAvatar
              src={current.avatarSrc}
              name={current.name}
              size="xl"
              fallback={builtinFallback(true, "tw-size-9")}
            />
          ) : (
            <BareButton
              aria-label={`Edit ${current.name}`}
              onClick={() => onOpenAgent(current)}
              className="tw-group tw-relative tw-rounded-full focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
            >
              <AgentAvatar
                src={current.avatarSrc}
                name={current.name}
                size="xl"
                className="tw-transition-opacity group-hover:tw-opacity-80"
              />
              <span className="tw-absolute tw-bottom-0 tw-right-0 tw-flex tw-size-6 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-primary tw-text-muted tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100 group-focus-visible:tw-opacity-100">
                <Pencil className="tw-size-3" />
              </span>
            </BareButton>
          )}
          <div className="tw-mt-1 tw-max-w-full tw-truncate tw-text-ui-larger tw-font-semibold tw-text-normal">
            {current.name}
          </div>
          <div
            title={current.description || undefined}
            className="tw-h-[1lh] tw-w-full tw-max-w-md tw-truncate tw-text-ui-small tw-leading-normal tw-text-muted"
          >
            {current.description}
          </div>
        </div>
      )}
      <AgentStrip section={section} onCreateAgent={onCreateAgent} labelledBy={headingId} />
    </div>
  );
};

AgentSpotlight.displayName = "AgentSpotlight";

const AgentStrip: React.FC<
  Omit<AgentSpotlightProps, "onOpenAgent"> & {
    labelledBy: string;
  }
> = ({ section, onCreateAgent, labelledBy }) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(0);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => {
      const entry = strip.firstElementChild as HTMLElement | null;
      if (!entry || entry.offsetWidth === 0) return;
      const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
      const next = Math.floor((strip.clientWidth + gap) / (entry.offsetWidth + gap));
      setSlots((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  const [copilot, ...agents] = section.rows;
  const { visible, overflow } = partitionOverflow(
    agents,
    countInlineAgents(slots, agents.length),
    section.selectedSlug,
    (row) => row.slug
  );
  const pick = (row: AgentPickerRow) => section.onSelect(row);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={stripRef}
        role="group"
        aria-labelledby={labelledBy}
        className="tw-flex tw-w-full tw-min-w-0 tw-justify-center tw-gap-1"
      >
        {copilot && (
          <AgentStripItem
            row={copilot}
            builtin
            selected={copilot.slug === section.selectedSlug}
            onSelect={pick}
          />
        )}
        {visible.map((row) => (
          <AgentStripItem
            key={row.slug}
            row={row}
            selected={row.slug === section.selectedSlug}
            onSelect={pick}
          />
        ))}
        {overflow.length > 0 && <AgentOverflowMenu rows={overflow} onSelect={pick} />}
        <StripButton label="New" title="Create an agent" onClick={onCreateAgent}>
          <span className={STRIP_CIRCLE_CLASS}>
            <Plus className="tw-size-4" />
          </span>
        </StripButton>
      </div>
    </TooltipProvider>
  );
};

const STRIP_CIRCLE_CLASS = cn(
  "tw-m-0.5 tw-flex tw-size-10 tw-items-center tw-justify-center tw-rounded-full",
  "tw-border tw-border-dashed tw-border-border tw-text-ui-small tw-font-semibold tw-text-muted"
);

const AgentStripItem: React.FC<{
  row: AgentPickerRow;
  builtin?: boolean;
  selected: boolean;
  onSelect: (row: AgentPickerRow) => void;
}> = ({ row, builtin = false, selected, onSelect }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <StripButton label={row.name} selected={selected} onClick={() => onSelect(row)}>
        <span className={cn("tw-rounded-full tw-p-0.5", selected && "tw-ring-2 tw-ring-ring")}>
          <AgentAvatar
            src={row.avatarSrc}
            name={row.name}
            size="md"
            fallback={builtinFallback(builtin, "tw-size-5")}
          />
        </span>
      </StripButton>
    </TooltipTrigger>
    <TooltipContent side="bottom" className="tw-max-w-64 tw-text-left">
      <div className="tw-font-semibold">{row.name}</div>
      {row.description && <div className="tw-text-muted">{row.description}</div>}
    </TooltipContent>
  </Tooltip>
);

const AgentOverflowMenu: React.FC<{
  rows: readonly AgentPickerRow[];
  onSelect: (row: AgentPickerRow) => void;
}> = ({ rows, onSelect }) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <StripButton label="More" title={`${rows.length} more agents`}>
        <span className={STRIP_CIRCLE_CLASS}>+{rows.length}</span>
      </StripButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="center" className="tw-max-h-72 tw-w-64 tw-overflow-y-auto">
      {rows.map((row) => (
        <DropdownMenuItem
          key={row.slug}
          onSelect={() => onSelect(row)}
          className="tw-items-start tw-gap-2"
        >
          <AgentGlyph name={row.name} avatarSrc={row.avatarSrc} className="tw-mt-0.5 tw-size-5" />
          <div className="tw-min-w-0">
            <div className="tw-truncate tw-text-ui-small tw-text-normal">{row.name}</div>
            {row.description && (
              <div className="tw-line-clamp-2 tw-text-ui-smaller tw-text-muted">
                {row.description}
              </div>
            )}
          </div>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

interface StripButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  title?: string;
  selected?: boolean;
}

const StripButton = React.forwardRef<HTMLButtonElement, StripButtonProps>(
  ({ label, title, selected, children, ...props }, ref) => (
    <BareButton
      ref={ref}
      {...props}
      aria-label={title}
      aria-pressed={selected}
      className={cn(
        "tw-flex tw-w-16 tw-shrink-0 tw-flex-col tw-items-center tw-gap-1.5 tw-rounded-md tw-px-1 tw-py-1.5",
        "hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
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
    </BareButton>
  )
);

StripButton.displayName = "StripButton";

export interface AgentLabelProps {
  name: string;
  avatarSrc: string | null;
  builtin: boolean;
}

export const AgentLabel: React.FC<AgentLabelProps> = ({ name, avatarSrc, builtin }) => (
  <span
    aria-label={`This chat is with ${name}. Start a new chat to talk to someone else, or @-mention them.`}
    className="tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-px-1 tw-text-muted"
  >
    <AgentGlyph
      name={name}
      avatarSrc={avatarSrc}
      fallback={builtinFallback(builtin, "tw-size-3.5")}
    />
    <span className="tw-truncate tw-text-sm">{name}</span>
  </span>
);

AgentLabel.displayName = "AgentLabel";
