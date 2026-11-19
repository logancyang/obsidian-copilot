import React from "react";

export interface ChatDayLabelProps {
  label: string;
}

export const ChatDayLabel: React.FC<ChatDayLabelProps> = ({ label }) => (
  <div className="tw-px-2 tw-pb-1 tw-pt-2 tw-text-center tw-text-xs tw-text-faint">{label}</div>
);
