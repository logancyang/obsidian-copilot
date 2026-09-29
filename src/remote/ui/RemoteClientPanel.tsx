import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import React, { useState } from "react";

export interface PairedDesktopView {
  id: string;
  desktopName: string;
  vaultName: string;
  address: string;
}

export interface RemoteClientPanelProps {
  desktops: readonly PairedDesktopView[];
  onPairFromLink: (link: string) => Promise<string>;
  onTestConnection: (id: string) => Promise<string>;
  onRemove: (id: string) => void;
}

const RemovedNote =
  "Removing a desktop only forgets it on this phone. Revoke the phone in the desktop's Remote settings to invalidate its token.";

export const RemoteClientPanel: React.FC<RemoteClientPanelProps> = ({
  desktops,
  onPairFromLink,
  onTestConnection,
  onRemove,
}) => {
  const [link, setLink] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairMessage, setPairMessage] = useState<string | null>(null);
  const [testMessages, setTestMessages] = useState<Readonly<Record<string, string>>>({});

  const pair = async (): Promise<void> => {
    setPairing(true);
    setPairMessage(null);
    try {
      const message = await onPairFromLink(link);
      setPairMessage(message);
      setLink("");
    } finally {
      setPairing(false);
    }
  };

  const test = async (id: string): Promise<void> => {
    setTestMessages((current) => ({ ...current, [id]: "Testing..." }));
    const message = await onTestConnection(id);
    setTestMessages((current) => ({ ...current, [id]: message }));
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <SettingSection
        label="Remote access"
        description="Pair this phone with the desktop that hosts your agent sessions. Open the vault here first, then scan the code shown in the desktop's Copilot settings under Remote."
      >
        <SettingItem
          type="custom"
          title="Paste a pairing link"
          description="If scanning does not open Obsidian, copy the link from the desktop and paste it here."
        >
          <div className="tw-flex tw-w-full tw-flex-col tw-gap-2 sm:tw-w-[300px]">
            <Input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="obsidian://copilot-pair?..."
              aria-label="Pairing link"
              disabled={pairing}
            />
            <Button size="sm" onClick={() => void pair()} disabled={pairing || link.trim() === ""}>
              {pairing ? "Pairing..." : "Pair"}
            </Button>
          </div>
        </SettingItem>
        {pairMessage && (
          <div role="status" className="tw-py-3 tw-text-sm tw-text-muted">
            {pairMessage}
          </div>
        )}
      </SettingSection>

      <SettingSection
        label="Paired desktops"
        description={desktops.length > 0 ? RemovedNote : undefined}
      >
        {desktops.length === 0 ? (
          <div className="tw-py-3 tw-text-sm tw-text-muted">
            No desktops are paired for this vault.
          </div>
        ) : (
          desktops.map((desktop) => (
            <SettingItem
              key={desktop.id}
              type="custom"
              title={desktop.desktopName}
              description={
                <>
                  {desktop.vaultName ? `${desktop.vaultName} at ` : ""}
                  {desktop.address}
                  {testMessages[desktop.id] && (
                    <span role="status" className="tw-block">
                      {testMessages[desktop.id]}
                    </span>
                  )}
                </>
              }
            >
              <div className="tw-flex tw-gap-2">
                <Button variant="secondary" size="sm" onClick={() => void test(desktop.id)}>
                  Test connection
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onRemove(desktop.id)}>
                  Remove
                </Button>
              </div>
            </SettingItem>
          ))
        )}
      </SettingSection>
    </div>
  );
};
