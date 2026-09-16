import { Button } from "@/components/ui/button";
import { createMiyoPageUrl } from "@/lib/miyoLinks";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { MiyoConnectionControl } from "./MiyoConnectionControl";
import { MiyoConnectionPanel, type MiyoConnectionPanelProps } from "./MiyoConnectionPanel";

function InteractiveConnection(args: Partial<MiyoConnectionPanelProps>) {
  const [active, setActive] = React.useState({
    mode: args.activeMode ?? args.mode ?? "local",
    address: "http://miyo-home:8742",
  });
  const [mode, setMode] = React.useState(args.mode ?? active.mode);
  const [address, setAddress] = React.useState(args.address ?? "");
  const [enabled, setEnabled] = React.useState(args.enabled ?? false);
  const checking = args.checking ?? false;
  const hasDraft = mode !== active.mode || (mode === "remote" && address.trim() !== active.address);
  return (
    <MiyoConnectionPanel
      {...args}
      activeMode={active.mode}
      enabled={enabled}
      status={args.status ?? "available"}
      checking={checking}
      mode={mode}
      address={address}
      downloadUrl={createMiyoPageUrl("miyo_settings")}
      onModeChange={setMode}
      onAddressChange={setAddress}
    >
      {!enabled || hasDraft ? (
        <Button
          variant="secondary"
          size="default"
          disabled={checking}
          onClick={() => {
            setActive({ mode, address: address.trim() });
            setEnabled(true);
          }}
        >
          Connect
        </Button>
      ) : (
        <MiyoConnectionControl
          checking={checking}
          onDisconnect={() => setEnabled(false)}
          onRetry={() => {}}
        />
      )}
    </MiyoConnectionPanel>
  );
}
const meta = {
  title: "Settings/Miyo Connection Setup",
  component: MiyoConnectionPanel,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<MiyoConnectionPanelProps>;
export default meta;
export const LocalSetup: StoryObj<MiyoConnectionPanelProps> = { render: InteractiveConnection };
export const MobileWithoutLocalMiyo: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "remote", activeMode: "local", localSupported: false },
  render: InteractiveConnection,
};
export const RemoteSetup: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "remote" },
  render: InteractiveConnection,
};
export const ConnectedLocal: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "local", enabled: true },
  render: InteractiveConnection,
};
export const ConnectedRemote: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "remote", address: "http://miyo-home:8742", enabled: true },
  render: InteractiveConnection,
};
export const UnreachableRemote: StoryObj<MiyoConnectionPanelProps> = {
  args: {
    mode: "remote",
    address: "http://miyo-home:8742",
    status: "unavailable",
    error:
      "Couldn't connect to this server. Check the address, access, and that Miyo is running, then retry.",
  },
  render: InteractiveConnection,
};
export const InvalidAddress: StoryObj<MiyoConnectionPanelProps> = {
  args: {
    mode: "remote",
    address: "miyo-home",
    error: "Enter a valid HTTP or HTTPS server address, without embedded credentials.",
  },
  render: InteractiveConnection,
};
export const BrowsingLocalWhileConnectedRemote: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "local", activeMode: "remote", address: "http://miyo-home:8742", enabled: true },
  render: InteractiveConnection,
};
export const BrowsingRemoteWhileConnectedLocal: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "remote", activeMode: "local", enabled: true },
  render: InteractiveConnection,
};
export const EditingConnectedRemoteAddress: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "remote", address: "http://miyo-work:8742", enabled: true },
  render: InteractiveConnection,
};
export const Offline: StoryObj<MiyoConnectionPanelProps> = {
  args: { enabled: true, status: "unavailable" },
  render: InteractiveConnection,
};
export const Checking: StoryObj<MiyoConnectionPanelProps> = {
  args: { enabled: true, status: "stale", checking: true },
  render: InteractiveConnection,
};
