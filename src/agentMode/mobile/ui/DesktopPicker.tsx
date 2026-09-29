import type { PairedDesktopView } from "@/remote/ui/RemoteClientPanel";
import { ChevronRight, Monitor } from "lucide-react";
import React from "react";

export interface DesktopPickerProps {
  desktops: readonly PairedDesktopView[];
  onSelect: (id: string) => void;
}

export const DesktopPicker: React.FC<DesktopPickerProps> = ({ desktops, onSelect }) => {
  if (desktops.length === 0) {
    return (
      <div
        role="status"
        className="tw-flex tw-size-full tw-flex-col tw-items-center tw-justify-center tw-gap-2 tw-p-6 tw-text-center"
      >
        <Monitor aria-hidden="true" className="tw-size-6 tw-text-muted" />
        <h2 className="tw-m-0 tw-text-base tw-font-medium tw-text-normal">No desktop paired</h2>
        <p className="tw-m-0 tw-max-w-xs tw-text-sm tw-text-muted">
          Pair this phone with your desktop in Copilot settings under Remote to steer its agent
          sessions from here.
        </p>
      </div>
    );
  }
  return (
    <div className="tw-flex tw-size-full tw-min-h-0 tw-flex-col tw-gap-3 tw-p-4">
      <div className="tw-flex tw-flex-col tw-gap-1">
        <h2 className="tw-m-0 tw-text-base tw-font-medium tw-text-normal">Choose a desktop</h2>
        <p className="tw-m-0 tw-text-sm tw-text-muted">
          This vault is paired with more than one desktop.
        </p>
      </div>
      <ul className="tw-m-0 tw-flex tw-min-h-0 tw-flex-1 tw-list-none tw-flex-col tw-gap-2 tw-overflow-y-auto tw-p-0">
        {desktops.map((desktop) => (
          <li key={desktop.id}>
            <button
              type="button"
              onClick={() => onSelect(desktop.id)}
              className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-3 tw-text-left tw-text-normal"
            >
              <Monitor aria-hidden="true" className="tw-size-5 tw-shrink-0 tw-text-muted" />
              <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
                <span className="tw-truncate tw-text-sm tw-font-medium">{desktop.desktopName}</span>
                <span className="tw-truncate tw-text-xs tw-text-muted">
                  {desktop.vaultName ? `${desktop.vaultName} at ` : ""}
                  {desktop.address}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
