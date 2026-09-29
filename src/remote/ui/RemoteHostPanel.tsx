import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import type { PairedDeviceView, RemoteHostViewState } from "@/remote/hostState";
import { QrCode } from "@/remote/ui/QrCode";
import React from "react";

export interface RemoteHostPanelProps {
  state: RemoteHostViewState;
  onStartPairing: () => void;
  onCancelPairing: () => void;
  onCopyLink: (link: string) => void;
  onRevoke: (deviceId: string) => void;
  onRecheck: () => void;
  onUpgrade: () => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function describeDevice(device: PairedDeviceView): string {
  const paired = `Paired ${dateFormat.format(device.createdAt)}`;
  if (device.connected) return `${paired}. Connected now.`;
  if (device.lastSeenAt === null) return `${paired}. Never connected.`;
  return `${paired}. Last seen ${dateFormat.format(device.lastSeenAt)}.`;
}

const PairingInstructions: React.FC<{
  link: string;
  onCopyLink: (link: string) => void;
  onCancelPairing: () => void;
}> = ({ link, onCopyLink, onCancelPairing }) => (
  <div className="tw-flex tw-flex-col tw-gap-4 tw-py-4 sm:tw-flex-row">
    <QrCode value={link} label="Pairing QR code" />
    <div className="tw-flex tw-flex-col tw-gap-3 tw-text-sm">
      <ol className="tw-m-0 tw-flex tw-list-decimal tw-flex-col tw-gap-2 tw-pl-5">
        <li>
          <strong className="tw-font-semibold">Open this same vault on your phone first.</strong>{" "}
          Obsidian drops the link if a different vault is open.
        </li>
        <li>Make sure Tailscale is on, then scan this code with the phone&apos;s Camera app.</li>
        <li>Tap the Obsidian link the Camera shows.</li>
      </ol>
      <div className="tw-text-xs tw-text-muted">
        The code works once and expires in 5 minutes. If scanning is awkward, copy the link, send it
        to your phone, and paste it in Copilot settings under Remote.
      </div>
      <div className="tw-flex tw-gap-2">
        <Button variant="secondary" size="sm" onClick={() => onCopyLink(link)}>
          Copy link
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancelPairing}>
          Cancel
        </Button>
      </div>
    </div>
  </div>
);

export const RemoteHostPanel: React.FC<RemoteHostPanelProps> = ({
  state,
  onStartPairing,
  onCancelPairing,
  onCopyLink,
  onRevoke,
  onRecheck,
  onUpgrade,
}) => {
  if (!state.plus) {
    return (
      <SettingSection label="Remote access">
        <SettingItem
          type="custom"
          title="Steer agents from your phone"
          description="Remote access needs Copilot Plus. Without it this vault never listens on your network."
        >
          <Button size="sm" onClick={onUpgrade}>
            See Copilot Plus
          </Button>
        </SettingItem>
      </SettingSection>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <SettingSection
        label="Remote access"
        description="Pair a phone to watch and steer this vault's agent sessions from Obsidian mobile over Tailscale."
      >
        {state.tailscaleAddress === null ? (
          <SettingItem
            type="custom"
            title="Tailscale not detected"
            description="Install Tailscale and sign in on this computer and on your phone. Copilot listens only on the Tailscale address, so nothing is reachable until it is running."
          >
            <Button variant="secondary" size="sm" onClick={onRecheck}>
              Check again
            </Button>
          </SettingItem>
        ) : state.pairing ? (
          <PairingInstructions
            link={state.pairing.link}
            onCopyLink={onCopyLink}
            onCancelPairing={onCancelPairing}
          />
        ) : (
          <SettingItem
            type="custom"
            title="Pair a phone"
            description="Both devices must be on the same Tailscale network. Copilot starts listening on the Tailscale address only while a pairing is open or a phone is paired."
          >
            <Button size="sm" onClick={onStartPairing}>
              Pair a phone
            </Button>
          </SettingItem>
        )}
        {state.error && (
          <div role="alert" className="tw-py-3 tw-text-sm tw-text-error">
            {state.error}
          </div>
        )}
      </SettingSection>

      <SettingSection label="Paired phones">
        {state.devices.length === 0 ? (
          <div className="tw-py-3 tw-text-sm tw-text-muted">
            No phones are paired with this vault.
          </div>
        ) : (
          state.devices.map((device) => (
            <SettingItem
              key={device.id}
              type="custom"
              title={device.name}
              description={describeDevice(device)}
            >
              <Button variant="secondary" size="sm" onClick={() => onRevoke(device.id)}>
                Revoke
              </Button>
            </SettingItem>
          ))
        )}
      </SettingSection>
    </div>
  );
};
