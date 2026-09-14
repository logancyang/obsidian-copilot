import { Input } from "@/components/ui/input";
import { SettingSection } from "@/components/ui/setting-section";
import { cn } from "@/lib/utils";
import React from "react";

export interface MiyoConnectionPanelProps {
  mode: "local" | "remote";
  address: string;
  onModeChange: (mode: "local" | "remote") => void;
  onAddressChange: (address: string) => void;
  downloadUrl: string;
  message?: string;
  error?: string;
  children: React.ReactNode;
}

/** Keeps both connection choices available before any server is running. */
export function MiyoConnectionPanel({
  mode,
  address,
  onModeChange,
  onAddressChange,
  downloadUrl,
  message,
  error,
  children,
}: MiyoConnectionPanelProps) {
  const groupId = React.useId();
  return (
    <SettingSection label="Connection">
      <div className="tw-space-y-3 tw-py-4">
        <div
          role="radiogroup"
          aria-label="Miyo connection"
          className="tw-flex tw-flex-wrap tw-gap-3"
        >
          {(["local", "remote"] as const).map((value) => (
            <label
              key={value}
              className={cn(
                "tw-flex tw-min-w-0 tw-flex-1 tw-basis-48 tw-cursor-pointer tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-p-3 focus-within:tw-ring-2 focus-within:tw-ring-ring",
                mode === value
                  ? "tw-border-interactive-accent tw-bg-interactive-accent/10"
                  : "tw-border-border tw-bg-secondary"
              )}
            >
              <input
                type="radio"
                name={groupId}
                value={value}
                checked={mode === value}
                onChange={() => onModeChange(value)}
              />
              <span className="tw-space-y-1">
                <span className="tw-block tw-text-sm tw-font-medium">
                  {value === "local" ? "This computer" : "Remote server"}
                </span>
                <span className="tw-block tw-text-xs tw-text-muted">
                  {value === "local"
                    ? "Connect to Miyo running locally."
                    : "Connect using a server address."}
                </span>
              </span>
            </label>
          ))}
        </div>
        {mode === "remote" ? (
          <div className="tw-space-y-2">
            <label htmlFor={`${groupId}-address`} className="tw-block tw-text-xs tw-font-medium">
              Server address
            </label>
            <Input
              id={`${groupId}-address`}
              value={address}
              onChange={(event) => onAddressChange(event.target.value)}
              placeholder="http://miyo-home:8742"
              aria-describedby={`${groupId}-hint`}
              aria-invalid={Boolean(error)}
            />
            <div id={`${groupId}-hint`} className="tw-text-xs tw-text-muted">
              Use the same Tailscale URL on both computers. No local installation needed.
            </div>
          </div>
        ) : (
          <div className="tw-text-xs tw-text-muted">
            Open Miyo on this computer, then connect. Don&apos;t have it yet?{" "}
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tw-text-accent"
            >
              Download
            </a>
          </div>
        )}
        {error && (
          <div role="alert" className="tw-text-xs tw-text-error">
            {error}
          </div>
        )}
        {children}
        {message && <div className="tw-text-xs tw-text-muted">{message}</div>}
      </div>
    </SettingSection>
  );
}
