import { AgentProjectCreateForm } from "@/agentMode/ui/AgentProjectCreateForm";
import { computeVerticalPlacement } from "@/utils/panelPlacement";
import * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CreateProjectPanelProps {
  /** The clicked trigger ("+ New project" row or Welcome button) to anchor to. */
  anchorEl: HTMLElement;
  onClose: () => void;
  /**
   * Persist the new project. Resolve to close the panel; reject to keep it open
   * with a Notice (e.g. a duplicate name).
   */
  onSave: (data: { name: string }) => Promise<void>;
}

/** Viewport-edge margin / anchor gap — matches Quick Command's placement inputs. */
const MARGIN = 12;
const GAP = 6;
const PANEL_WIDTH = 260;
/** First-paint height guess, replaced by a real measurement in useLayoutEffect. */
const ESTIMATED_HEIGHT = 140;

interface PanelPosition {
  top: number;
  left: number;
}

/**
 * A lightweight, anchored "new project" popover. Unlike a screen-centered
 * modal, it opens next to the trigger and flips below/above/center by available
 * space — reusing Quick Command's placement
 * brain ({@link computeVerticalPlacement}) and the name-only create form
 * ({@link AgentProjectCreateForm}). Portaled into the trigger's own
 * document so it lands in the right window when the view is popped out.
 */
export function CreateProjectPanel({
  anchorEl,
  onClose,
  onSave,
}: CreateProjectPanelProps): React.ReactPortal {
  const panelRef = useRef<HTMLDivElement>(null);
  const doc = anchorEl.ownerDocument;
  const win = doc.defaultView ?? window;

  // Place from the trigger's rect. The same rect is fed as both the top and
  // bottom anchor, so the helper reads "below" = under the trigger and "above"
  // = over it; with neither fitting it falls back to viewport center.
  const computePosition = useCallback(
    (panelHeight: number): PanelPosition => {
      const rect = anchorEl.getBoundingClientRect();
      const { top } = computeVerticalPlacement({
        scrollRect: { top: 0, bottom: win.innerHeight },
        visibleBottom: rect,
        visibleTop: rect,
        panelHeight,
        margin: MARGIN,
        gap: GAP,
        viewportHeight: win.innerHeight,
      });
      // Center the panel on the trigger's horizontal midpoint. The "+ New
      // project" row and Welcome button span the project pane, so their midpoint
      // is the pane's center — reads better than hugging the left edge.
      const centeredLeft = rect.left + rect.width / 2 - PANEL_WIDTH / 2;
      const left = Math.max(MARGIN, Math.min(centeredLeft, win.innerWidth - PANEL_WIDTH - MARGIN));
      return { top, left };
    },
    [anchorEl, win]
  );

  const [position, setPosition] = useState<PanelPosition>(() => computePosition(ESTIMATED_HEIGHT));

  // Re-place with the panel's REAL height once mounted (and on resize): a height
  // estimate smaller than the real panel would put an "above" placement on top
  // of the trigger. Mirrors QuickAskOverlay, which measures then finalizes.
  //
  // DESIGN NOTE: re-anchors on resize only, NOT on scroll — this is a transient
  // name+Enter popover whose primary exits are submit / Esc / outside-click, so
  // a mid-edit scroll of the landing is an edge case not worth a scroll listener
  // or ResizeObserver. If scroll-follow is ever needed, prefer close-on-scroll
  // over reposition.
  useLayoutEffect(() => {
    const reposition = () =>
      setPosition(computePosition(panelRef.current?.offsetHeight ?? ESTIMATED_HEIGHT));
    reposition();
    win.addEventListener("resize", reposition);
    return () => win.removeEventListener("resize", reposition);
  }, [computePosition, win]);

  // Escape + click-outside dismissal (no shared hook exists; mirrors
  // QuickAskOverlay). `defaultPrevented` lets an inner control consume Escape
  // first; a pointerdown on the trigger itself is ignored so it doesn't
  // close-then-reopen.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && !panelRef.current?.contains(target) && !anchorEl.contains(target)) {
        onClose();
      }
    };
    win.addEventListener("keydown", onKeyDown);
    doc.addEventListener("mousedown", onPointerDown, true);
    return () => {
      win.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [anchorEl, doc, win, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="New project"
      className="tw-fixed tw-z-popover tw-w-[260px] tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-shadow-lg"
      // Dynamic pixel position (computed from the anchor) — inline style is the
      // established pattern for this in `command-ui/draggable-modal.tsx`.
      style={{ top: position.top, left: position.left }}
    >
      <AgentProjectCreateForm
        title="New project"
        subtitle="Create a new project in your vault"
        onSave={onSave}
        onCancel={onClose}
      />
    </div>,
    doc.body
  );
}

export default CreateProjectPanel;
