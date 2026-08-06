import React from "react";

export interface AgentSelectPaneProps {
  /** Live chooser card supplied by the runtime container. */
  children: React.ReactNode;
  /** Persistent Agent Mode controls shown below the chooser. */
  controls: React.ReactNode;
}

/**
 * Full cold-start pane layout around the agent chooser. The scroll area uses
 * auto margins so the card is centered when space permits and starts at the
 * top, without clipping, when the pane becomes shorter than the card.
 */
export const AgentSelectPane: React.FC<AgentSelectPaneProps> = ({ children, controls }) => (
  <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-y-auto tw-p-2">
      <div className="tw-m-auto tw-w-full">{children}</div>
    </div>
    {controls}
  </div>
);
