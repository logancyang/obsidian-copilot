import { AgentHomeTab } from "@/agentMode/ui/AgentHomeTab";
import { cn } from "@/lib/utils";
import React, { useId, useState } from "react";

/**
 * Reserved floor for the shelf's panel body. Deliberately a *floor*, not an
 * equal-height lock: full tabs (INLINE_LIMIT rows) all land within ~10px of
 * each other naturally, and this floor just keeps short/empty lists from
 * collapsing the card — the standard reserve-space-to-avoid-layout-shift
 * pattern. AgentContextSection imports this for its standalone (no-shelf)
 * rendering so the two surfaces can't drift.
 */
export const SHELF_BODY_FLOOR_CLASS = "tw-min-h-48";

export interface AgentHomeShelfSection {
  /** Stable id used for tab selection. */
  id: string;
  /** Leading type icon for the tab. */
  icon: React.ReactNode;
  title: string;
  count: number;
  /** Rendered into the panel while this tab is the selected one. */
  renderBody: () => React.ReactNode;
  /**
   * When true, the tab is greyed out and cannot be selected, and its body is
   * never mounted (used for features that aren't shipped yet). The shelf keeps
   * a disabled section from becoming active, so its `renderBody` never runs.
   */
  disabled?: boolean;
  /** Hover hint shown over a disabled tab (e.g. "Coming soon"). */
  disabledTooltip?: string;
}

interface AgentHomeShelfProps {
  sections: AgentHomeShelfSection[];
  className?: string;
  /**
   * Controlled selection: when provided (non-undefined), the parent owns the
   * active tab and must update it via `onSectionSelect`. Used by the global
   * landing so the selected tab survives this shelf unmounting while a project
   * is open. Omit for the default uncontrolled behavior (project shelves,
   * which deliberately reset per project via `key`).
   *
   * DESIGN NOTE: these are independent optionals, not a controlled/uncontrolled
   * union — matching the Radix/standard React convention (and `value`/`onChange`
   * pairs elsewhere in this repo). Passing `activeSectionId` without
   * `onSectionSelect` yields a read-only tab bar, which is legal controlled
   * behavior, not a footgun worth a union type; the only controlled caller
   * (AgentHome's global landing) passes both.
   */
  activeSectionId?: string | null;
  onSectionSelect?: (id: string) => void;
}

/**
 * Agent Home landing shelf: a persistent card whose header is a segmented tab
 * bar (one tab per section) over a single panel body. Exactly one tab is always
 * selected — clicking another swaps the body; there is no collapsed state. The
 * section bodies are sized to lead with the same number of rows, so switching
 * tabs doesn't change the card height.
 */
export function AgentHomeShelf({
  sections,
  className,
  activeSectionId,
  onSectionSelect,
}: AgentHomeShelfProps): React.ReactElement {
  // Default to (and only ever resolve to) the first selectable section — a
  // disabled tab can't be activated, so its body never mounts.
  const firstSelectable = sections.find((s) => !s.disabled) ?? null;
  const [internalActiveId, setInternalActiveId] = useState<string | null>(
    firstSelectable?.id ?? null
  );
  // Controlled when the parent passes `activeSectionId` (null counts as "parent
  // owns it, nothing picked yet" and resolves to the first selectable below).
  const isControlled = activeSectionId !== undefined;
  const activeId = isControlled ? activeSectionId : internalActiveId;
  const selectSection = (id: string) => {
    if (!isControlled) setInternalActiveId(id);
    onSectionSelect?.(id);
  };
  const requested = sections.find((s) => s.id === activeId);
  const active = requested && !requested.disabled ? requested : firstSelectable;
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
            disabled={section.disabled}
            disabledTooltip={section.disabledTooltip}
            onClick={() => selectSection(section.id)}
          />
        ))}
      </div>
      {/* The panel is the scroll container; the inner wrapper carries the
          min-height floor (SHELF_BODY_FLOOR_CLASS) so a short/empty list can't
          collapse the card. It is also a flex column so a section can tw-grow
          to fill the floor (centering its empty-state copy). With room the card
          sizes to that content and sits at the top of the region; on a pane
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
        <div className={cn(SHELF_BODY_FLOOR_CLASS, "tw-flex tw-flex-col tw-pb-1")}>
          {active.renderBody()}
        </div>
      </div>
    </div>
  );
}
