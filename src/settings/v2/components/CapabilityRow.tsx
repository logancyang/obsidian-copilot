import React from "react";

export interface CapabilityRowProps {
  title: React.ReactNode;
  description: React.ReactNode;
  control: React.ReactNode;
}

export const CapabilityRow: React.FC<CapabilityRowProps> = ({ title, description, control }) => (
  <div className="tw-flex tw-flex-col tw-items-start tw-justify-between tw-gap-4 tw-py-4 sm:tw-flex-row sm:tw-items-center">
    <div className="tw-w-full tw-space-y-1.5 sm:tw-w-[300px]">
      <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-medium tw-leading-none">
        {title}
      </div>
      <div className="tw-text-xs tw-text-muted">{description}</div>
    </div>
    <div className="tw-flex tw-w-full tw-flex-1 tw-items-center tw-gap-2 sm:tw-justify-end">
      {control}
    </div>
  </div>
);
