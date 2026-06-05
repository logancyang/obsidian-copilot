import { AgentHomeChip } from "@/agentMode/ui/AgentHomeChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

export interface AgentHomeShelfSection {
  /** Stable id used for selection. */
  id: string;
  /** Leading type icon for the chip and the open panel's header. */
  icon: React.ReactNode;
  title: string;
  count: number;
  /** Rendered into the panel only while this section is the open one. */
  renderBody: () => React.ReactNode;
}

interface AgentHomeShelfProps {
  sections: AgentHomeShelfSection[];
  className?: string;
}

/**
 * Claude-style shelf for the Agent Home landing. Collapsed, it's a centered row
 * of chips (one per section). Opening a chip *replaces* the whole row with that
 * section's panel — a titled card (icon + title + close button) over the section
 * body — so the landing shows either the chips or exactly one open panel, never
 * both at once. Closing returns to the chip row.
 */
export function AgentHomeShelf({ sections, className }: AgentHomeShelfProps): React.ReactElement {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId != null ? (sections.find((s) => s.id === activeId) ?? null) : null;
  const panelRef = useRef<HTMLDivElement>(null);

  // A click anywhere outside the open panel collapses it back to the chip row.
  // Bound to the panel's ownerDocument so it also fires in Obsidian popout
  // windows. Clicks inside the panel — or inside a Radix popover it spawned (the
  // "View all" popovers portal outside the panel's DOM subtree) — are ignored so
  // those flows aren't dismissed by the same gesture.
  useEffect(() => {
    if (activeId == null) return;
    const doc = panelRef.current?.ownerDocument ?? activeDocument;
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      // The target may live in a Radix popover this panel spawned (portaled
      // outside its DOM subtree); a feature-checked `closest` keeps those open
      // without an `instanceof` that breaks across popout windows.
      const el = target as Element;
      if (typeof el.closest === "function" && el.closest("[data-radix-popper-content-wrapper]"))
        return;
      setActiveId(null);
    };
    doc.addEventListener("pointerdown", onPointerDown);
    return () => doc.removeEventListener("pointerdown", onPointerDown);
  }, [activeId]);

  // Collapsed: just the centered chip row.
  if (!active) {
    return (
      <div
        className={cn("tw-flex tw-flex-wrap tw-items-center tw-justify-center tw-gap-2", className)}
      >
        {sections.map((section) => (
          <AgentHomeChip
            key={section.id}
            icon={section.icon}
            title={section.title}
            count={section.count}
            onClick={() => setActiveId(section.id)}
          />
        ))}
      </div>
    );
  }

  // Open: a titled card replacing the chip row. The parent region owns the
  // scroll, so the card grows with its body rather than scrolling internally.
  return (
    <div
      ref={panelRef}
      className={cn(
        "tw-flex tw-flex-col tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary",
        "tw-duration-200 tw-animate-in tw-fade-in-0",
        className
      )}
    >
      {/* Header carries the identity the chip showed (icon + title) plus the
          close affordance back to the chip row. */}
      <div className="tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-text-muted">
          <span className="tw-flex tw-shrink-0 tw-items-center">{active.icon}</span>
          <span className="tw-truncate tw-text-ui-small tw-font-medium">{active.title}</span>
        </div>
        <Button
          variant="ghost2"
          size="icon"
          onClick={() => setActiveId(null)}
          aria-label={`Close ${active.title}`}
          className="tw-size-6 tw-shrink-0"
        >
          <X className="tw-size-4" />
        </Button>
      </div>
      <div className="tw-px-1 tw-pb-2">{active.renderBody()}</div>
    </div>
  );
}
