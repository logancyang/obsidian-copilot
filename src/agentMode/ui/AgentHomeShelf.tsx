import { AgentHomeTab } from "@/agentMode/ui/AgentHomeTab";
import { cn } from "@/lib/utils";
import React, { useId, useState } from "react";

export interface AgentHomeShelfSection {
  /** Stable id used for tab selection. */
  id: string;
  /** Leading type icon for the tab. */
  icon: React.ReactNode;
  title: string;
  count: number;
  /** Rendered into the panel while this tab is the selected one. */
  renderBody: () => React.ReactNode;
}

interface AgentHomeShelfProps {
  sections: AgentHomeShelfSection[];
  className?: string;
}

/**
 * Agent Home landing shelf: a persistent card whose header is a segmented tab
 * bar (one tab per section) over a single panel body. Exactly one tab is always
 * selected — clicking another swaps the body; there is no collapsed state. The
 * section bodies are sized to lead with the same number of rows, so switching
 * tabs doesn't change the card height.
 */
export function AgentHomeShelf({ sections, className }: AgentHomeShelfProps): React.ReactElement {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const active = sections.find((s) => s.id === activeId) ?? sections[0] ?? null;
  const panelId = useId();

  // Stable per-tab id so the single shared panel can point back at the *active*
  // tab via aria-labelledby (mirrors the setting-tabs pattern).
  const tabId = (sectionId: string) => `${panelId}-tab-${sectionId}`;

  if (!active) return <></>;

  return (
    <div
      className={cn(
        // Flex column with min-h-0 so the card can shrink below its content when
        // the region is short (see the panel comment) — then `overflow-hidden`
        // still clips the rounded corners while the panel scrolls inside.
        "tw-flex tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary",
        className
      )}
    >
      {/* DESIGN NOTE: tabs activate on click and Enter/Space (native <button>),
          but there is no arrow-key roving (Left/Right/Home/End) — this matches
          every other role="tab" in the project (AgentTabStrip, setting-tabs,
          AskUserQuestionCard), none of which implement the full APG roving model.
          Adding it here alone would make this the sole exception and diverge from
          the established baseline; roving is tracked as a global tab-primitive
          a11y debt to land uniformly, not piecemeal. This is "follows the project
          baseline", not "fully APG-compliant". If a future review flags the
          missing arrow-key model again, point them at this note. */}
      <div role="tablist" className="tw-flex tw-shrink-0 tw-gap-1 tw-bg-secondary tw-p-1.5">
        {sections.map((section) => (
          <AgentHomeTab
            key={section.id}
            id={tabId(section.id)}
            icon={section.icon}
            title={section.title}
            count={section.count}
            active={section.id === active.id}
            controlsId={panelId}
            onClick={() => setActiveId(section.id)}
          />
        ))}
      </div>
      {/* The panel is the scroll container; the inner wrapper carries the fixed
          min-height (create row + 3 item rows + "View all") so the card keeps the
          same height across tabs and when a list is short/empty. With room the
          card sizes to that content and sits at the top of the region; on a pane
          too short to fit it the card shrinks (min-h-0 on the card + min-h-0 here)
          and this panel scrolls its list internally while the tab bar stays
          pinned — instead of the card being clipped out of reach. The floor lives
          on the inner div, not this scroll element, because `min-height` would
          otherwise win over the shrink and re-break the overflow. */}
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(active.id)}
        className="tw-min-h-0 tw-overflow-y-auto"
      >
        <div className="tw-min-h-48 tw-pb-1">{active.renderBody()}</div>
      </div>
    </div>
  );
}
