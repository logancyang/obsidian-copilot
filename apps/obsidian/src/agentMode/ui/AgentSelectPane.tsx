import React from "react";

export interface AgentSelectPaneProps {
  children: React.ReactNode;
  controls: React.ReactNode;
}

export const AgentSelectPane: React.FC<AgentSelectPaneProps> = ({ children, controls }) => (
  <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-y-auto tw-p-2">
      <div className="tw-m-auto tw-w-full">{children}</div>
    </div>
    {controls}
  </div>
);
