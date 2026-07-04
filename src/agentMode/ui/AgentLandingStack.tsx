import React from "react";

interface AgentLandingStackProps {
  /** Brand icon + greeting (global) or "Chat in <project>" hero (project landing). */
  hero: React.ReactNode;
  /**
   * The composer. Passed as a slot so the same `AgentChatInput` element the
   * conversation state renders can sit at the frozen landing position.
   */
  composer: React.ReactNode;
  /**
   * Welcome card (global landing) OR context-load card (project landing) —
   * mutually exclusive. Floats between the composer and the shelf.
   */
  floating?: React.ReactNode;
  /**
   * Standalone project Context body (the zero-chat project landing, where no
   * shelf renders). Project landing only; sits below the floating slot.
   */
  context?: React.ReactNode;
  /**
   * Tabbed shelf (Recent Chats / Projects, or Project Chats / Context). Omitted
   * on the zero-chat project landing, where the `context` slot renders instead —
   * the wrapper (and its top padding) is skipped so no empty gap remains.
   */
  shelf?: React.ReactNode;
}

/**
 * Pure layout for the Agent Home landing — both the global and per-project
 * variants render through this so the mount order is frozen in one place:
 * `hero → composer → [floating] → [context] → shelf`.
 *
 * The composer is **top-anchored**, not centered: a fixed-fraction (`h-1/4`)
 * spacer pins it a quarter of the way down so its own height changes (e.g. a
 * context chip appearing) don't shift it — the flex-1 shelf region below absorbs
 * the slack instead. This matches the shipped global landing (decision #2550);
 * the wireframe's vertically-centered hero is intentionally dropped.
 *
 * Presentational only: the parent owns the scrolling/padded column wrapper and
 * feeds each slot.
 */
export function AgentLandingStack({
  hero,
  composer,
  floating,
  context,
  shelf,
}: AgentLandingStackProps): React.ReactElement {
  return (
    <>
      <div className="tw-h-1/4 tw-shrink-0" />
      <div className="tw-shrink-0 tw-pb-7">{hero}</div>
      <div className="tw-shrink-0">{composer}</div>
      {/* floating + context own their own padding (`tw-px-2 tw-pb-1`), so the
          wrappers carry no padding of their own — when a slot's component
          self-hides (e.g. the context-load card returning null once context is
          ready) the `shrink-0` wrapper collapses to 0px instead of leaving a stray
          gap above the shelf. Omitted entirely when the slot is empty, so the
          global landing's DOM is unchanged. */}
      {floating ? <div className="tw-shrink-0">{floating}</div> : null}
      {context ? <div className="tw-shrink-0">{context}</div> : null}
      {shelf ? (
        <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-pt-6">{shelf}</div>
      ) : null}
    </>
  );
}

export default AgentLandingStack;
