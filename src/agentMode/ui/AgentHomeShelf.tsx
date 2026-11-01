import { AgentHomeTab } from "@/agentMode/ui/AgentHomeTab";
import { cn } from "@/lib/utils";
import React, { useId, useState } from "react";

export interface AgentHomeShelfSection {
  id: string;
  icon: React.ReactNode;
  title: string;
  count?: number;
  renderBody: () => React.ReactNode;
  disabled?: boolean;
  disabledTooltip?: string;
}

export function landingSectionsForSidebar(
  sections: AgentHomeShelfSection[],
  sidebarOpen: boolean
): AgentHomeShelfSection[] {
  return sidebarOpen ? sections.filter((section) => section.id === "relevant-notes") : sections;
}

interface AgentHomeShelfProps {
  sections: AgentHomeShelfSection[];
  className?: string;
  activeSectionId?: string | null;
  onSectionSelect?: (id: string) => void;
}

interface AgentHomeShelfViewportProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function AgentHomeShelfViewport({
  children,
  ...attributes
}: AgentHomeShelfViewportProps): React.ReactElement {
  return (
    <div {...attributes} className="tw-h-96 tw-max-h-96 tw-min-h-0 tw-overflow-y-auto">
      <div className="tw-flex tw-h-full tw-min-h-full tw-flex-col tw-pb-1">{children}</div>
    </div>
  );
}

export function AgentHomeShelf({
  sections,
  className,
  activeSectionId,
  onSectionSelect,
}: AgentHomeShelfProps): React.ReactElement {
  const firstSelectable = sections.find((s) => !s.disabled) ?? null;
  const [internalActiveId, setInternalActiveId] = useState<string | null>(
    firstSelectable?.id ?? null
  );
  const isControlled = activeSectionId !== undefined;
  const activeId = isControlled ? activeSectionId : internalActiveId;
  const selectSection = (id: string) => {
    if (!isControlled) setInternalActiveId(id);
    onSectionSelect?.(id);
  };
  const requested = sections.find((s) => s.id === activeId);
  const active = requested && !requested.disabled ? requested : firstSelectable;
  const panelId = useId();

  const tabId = (sectionId: string) => `${panelId}-tab-${sectionId}`;

  if (!active) return <></>;

  const frameClassName = cn(
    "tw-flex tw-min-h-0 tw-flex-col tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary",
    className
  );

  // With the sessions sidebar open only Relevant Notes is left, and a lone tab reads as stray chrome.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/804
  if (sections.length === 1) {
    return (
      <section aria-label={active.title} className={frameClassName}>
        <AgentHomeShelfViewport>{active.renderBody()}</AgentHomeShelfViewport>
      </section>
    );
  }

  return (
    <div className={frameClassName}>
      <div role="tablist" className="tw-flex tw-shrink-0 tw-gap-1 tw-bg-secondary tw-p-1.5">
        {sections.map((section) => (
          <AgentHomeTab
            key={section.id}
            id={tabId(section.id)}
            sectionId={section.id}
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
      <AgentHomeShelfViewport id={panelId} role="tabpanel" aria-labelledby={tabId(active.id)}>
        {active.renderBody()}
      </AgentHomeShelfViewport>
    </div>
  );
}
