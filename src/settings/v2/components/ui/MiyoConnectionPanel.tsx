import { Badge } from "@/components/ui/badge";
import type { CapabilityStatus } from "@/miyo/miyoStatusStore";
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
  activeMode: "local" | "remote";
  enabled: boolean;
  status: CapabilityStatus;
  checking: boolean;
  /**
   * Whether a Miyo on this device can be reached at all. False on mobile, where
   * service discovery has no equivalent, so Local can only ever fail to connect.
   */
  localSupported?: boolean;
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
  activeMode,
  enabled,
  status,
  checking,
  localSupported = true,
  error,
  children,
}: MiyoConnectionPanelProps) {
  const groupId = React.useId();
  const connected = enabled && (status === "available" || status === "stale");
  const statusLabel = checking ? "Checking…" : connected ? "Connected" : "Offline";
  return (
    <SettingSection label="Connection">
      <div className="tw-space-y-3 tw-py-4">
        <div
          role="radiogroup"
          aria-label="Miyo connection"
          className="tw-flex tw-flex-wrap tw-gap-3"
        >
          {(["local", "remote"] as const).map((value) => {
            const unavailable = value === "local" && !localSupported;
            return (
              <label
                key={value}
                className={cn(
                  "tw-min-w-0 tw-flex-1 tw-basis-48 tw-space-y-1 tw-rounded-lg tw-border tw-border-solid tw-p-3 focus-within:tw-ring-2 focus-within:tw-ring-ring",
                  unavailable ? "tw-cursor-not-allowed tw-opacity-45" : "tw-cursor-pointer",
                  mode === value
                    ? "tw-border-interactive-accent tw-bg-interactive-accent/10"
                    : "tw-border-border tw-bg-secondary"
                )}
                aria-disabled={unavailable}
              >
                <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                  <span className="tw-inline-flex tw-items-center tw-gap-2">
                    <input
                      type="radio"
                      className="tw-m-0 tw-size-4 tw-shrink-0"
                      name={groupId}
                      value={value}
                      checked={mode === value}
                      disabled={unavailable}
                      onChange={() => onModeChange(value)}
                    />
                    <span className="tw-text-sm tw-font-medium">
                      {value === "local" ? "Local" : "Remote server"}
                    </span>
                  </span>
                  {/* The badge belongs to the confirmed endpoint while another option is a draft.
                      https://github.com/Brevilabs/obsidian-copilot-private/issues/466 */}
                  {activeMode === value && !unavailable && (
                    <Badge
                      role="status"
                      variant={connected && !checking ? "success" : "secondary"}
                      className="tw-px-1 tw-text-xs"
                    >
                      {statusLabel}
                    </Badge>
                  )}
                </div>
                <span className="tw-block tw-text-xs tw-text-muted">
                  {value === "remote"
                    ? "Connect using a server address."
                    : unavailable
                      ? "Needs Miyo running on this device. Use Remote server instead."
                      : "Connect to Miyo running locally."}
                </span>
              </label>
            );
          })}
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
              aria-invalid={Boolean(error)}
            />
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
      </div>
    </SettingSection>
  );
}
