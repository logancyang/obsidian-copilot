import { SettingSwitch } from "@/components/ui/setting-switch";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import React, { useId } from "react";

export interface RelevantNotesToolbarProps {
  /** Basename of the note being related, or undefined when there is none. */
  activeFileName: string | undefined;
  /** Omitted when Miyo is off, since there is no index to follow. */
  liveUpdate?: {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
  };
}

/**
 * Name the note Relevant Notes is searching against and expose live update.
 *
 * @param activeFileName - Basename shown as the search source.
 * @param liveUpdate - Current live-update state and its setter, when offering
 *   the control makes sense.
 */
export function RelevantNotesToolbar({
  activeFileName,
  liveUpdate,
}: RelevantNotesToolbarProps): React.ReactElement {
  const labelId = useId();

  return (
    <div className="tw-flex tw-flex-none tw-items-center tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-border tw-px-3 tw-py-2">
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1.5 tw-text-xs tw-text-faint">
        <span className="tw-shrink-0">Relevant to</span>
        {activeFileName ? (
          <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-text-muted">
            <FileText className="tw-size-3.5 tw-shrink-0" />
            <span className="tw-truncate tw-font-medium tw-text-normal">{activeFileName}</span>
          </span>
        ) : (
          <span className="tw-text-muted">—</span>
        )}
      </div>
      {liveUpdate && (
        <div
          title="Re-rank these notes while you write"
          className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-text-xs"
        >
          {/*
            The switch is a div with role="switch", which no <label> can name or
            activate, so the visible word both names it and toggles it itself.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/362
          */}
          <span
            id={labelId}
            onClick={() => liveUpdate.onChange(!liveUpdate.enabled)}
            className={cn(
              "tw-cursor-pointer",
              liveUpdate.enabled ? "tw-text-normal" : "tw-text-faint"
            )}
          >
            Live
          </span>
          <SettingSwitch
            aria-labelledby={labelId}
            checked={liveUpdate.enabled}
            onCheckedChange={liveUpdate.onChange}
          />
        </div>
      )}
    </div>
  );
}
