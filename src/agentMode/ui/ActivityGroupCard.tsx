import React, { useId } from "react";
import { ChevronDown, ChevronRight, Layers, Loader2, type LucideIcon } from "lucide-react";
import {
  summarizeActivity,
  type ActivityGroupNode,
  type ActivityMember,
} from "@/agentMode/ui/activityGroups";
import { pickToolIcon } from "@/agentMode/ui/toolIcons";

export interface ActivityGroupCardProps {
  group: ActivityGroupNode;
  /**
   * Measured reasoning wall-clock for this group, passed through to
   * `summarizeActivity`. The card never measures time itself — `thought`
   * parts carry no timestamps, so the trail owns the clock.
   */
  thinkingMs?: number;
  /**
   * Whether the body is showing. Fully controlled: a group must stay open
   * across streaming updates, which only works if the owner of the trail holds
   * this state.
   */
  open: boolean;
  onToggle: () => void;
  /**
   * Renders one member. Injected rather than imported so this file stays
   * unaware of the concrete cards the trail dispatches to.
   */
  renderMember: (member: ActivityMember, key: string | number) => React.ReactNode;
  /**
   * Transient row for the step currently in flight, shown under the summary
   * line while the group is collapsed. When the group is open the live member
   * is already visible in the body, so the row would only duplicate it.
   */
  liveStep?: React.ReactNode;
}

/**
 * One collapsed run of the agent's tool calls and reasoning, summarized as a
 * single line the user can open. Groups are born collapsed and never close
 * themselves, so nothing the user is mid-read disappears; see
 * `designdocs/AGENT_TRAIL_GROUPING.md`.
 */
export const ActivityGroupCard: React.FC<ActivityGroupCardProps> = ({
  group,
  thinkingMs,
  open,
  onToggle,
  renderMember,
  liveStep,
}) => {
  const bodyId = useId();
  const summary = summarizeActivity(group.members, { thinkingMs });
  const Icon = groupIcon(group.members);
  const isProcessing = group.members.some(
    (m) => m.type === "action" && (m.part.status === "pending" || m.part.status === "in_progress")
  );

  return (
    <div className="tw-my-1 tw-flex tw-flex-col tw-gap-0.5">
      {/* A native `button` here inherits Obsidian's button chrome — a grey fill
          and an inset shadow that no Tailwind reset outranks — so the row would
          render as a pill among the trail's flat rows. Every sibling card uses
          this shape for the same reason; the keyboard handler keeps it operable. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onToggle();
        }}
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-1.5 tw-text-sm tw-text-muted hover:tw-text-normal"
      >
        <Icon className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
        <span className="tw-flex-1 tw-truncate tw-font-medium">{summary.line}</span>
        {summary.failed > 0 ? (
          <span className="tw-shrink-0 tw-text-xs tw-text-muted">{summary.failed} failed</span>
        ) : null}
        {isProcessing ? (
          <Loader2 className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading" />
        ) : null}
        {open ? (
          <ChevronDown className="tw-size-3 tw-shrink-0 tw-text-muted" />
        ) : (
          <ChevronRight className="tw-size-3 tw-shrink-0 tw-text-muted" />
        )}
      </div>
      {!open && liveStep ? (
        <div className="tw-truncate tw-pl-5 tw-text-xs tw-text-muted">{liveStep}</div>
      ) : null}
      {open ? (
        <div
          id={bodyId}
          className="tw-mt-1 tw-flex tw-flex-col tw-border-l tw-border-border tw-pl-3"
        >
          {group.members.map((m, i) => renderMember(m, i))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * The group's leading glyph: its members' own icon when they all resolve to
 * one, and a neutral stack when the run mixes families — inventing a winner
 * among unrelated tools would misdescribe the row.
 */
function groupIcon(members: ActivityMember[]): LucideIcon {
  const icons = new Set<LucideIcon>();
  for (const m of members) {
    if (m.type !== "action") continue;
    icons.add(pickToolIcon({ vendorToolName: m.part.vendorToolName, toolKind: m.part.toolKind }));
  }
  return icons.size === 1 ? [...icons][0] : Layers;
}
