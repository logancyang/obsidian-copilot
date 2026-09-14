import { Button } from "@/components/ui/button";
import { createMiyoPageUrl } from "@/lib/miyoLinks";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { MiyoConnectionControl } from "./MiyoConnectionControl";
import { MiyoConnectionPanel, type MiyoConnectionPanelProps } from "./MiyoConnectionPanel";

function InteractiveConnection(args: Partial<MiyoConnectionPanelProps>) {
  const [mode, setMode] = React.useState(args.mode ?? "local");
  const [address, setAddress] = React.useState(args.address ?? "");
  return (
    <MiyoConnectionPanel
      {...args}
      mode={mode}
      address={address}
      downloadUrl={createMiyoPageUrl("miyo_settings")}
      onModeChange={setMode}
      onAddressChange={setAddress}
    >
      {args.children ?? (
        <Button variant="secondary" size="default">
          Connect
        </Button>
      )}
    </MiyoConnectionPanel>
  );
}
function ConnectedDraft(args: Partial<MiyoConnectionPanelProps>) {
  const [active, setActive] = React.useState({
    mode: "remote" as "local" | "remote",
    address: "http://miyo-home:8742",
  });
  const [mode, setMode] = React.useState(args.mode ?? active.mode);
  const [address, setAddress] = React.useState(args.address ?? active.address);
  const [enabled, setEnabled] = React.useState(true);
  return (
    <MiyoConnectionPanel
      connectionStatus={
        <MiyoConnectionControl
          enabled={enabled}
          status="available"
          remote={active.mode === "remote"}
          checking={false}
          onDisconnect={() => setEnabled(false)}
          onRetry={() => {}}
        />
      }
      mode={mode}
      address={address}
      downloadUrl={createMiyoPageUrl("miyo_settings")}
      onModeChange={setMode}
      onAddressChange={setAddress}
    >
      {(!enabled ||
        mode !== active.mode ||
        (mode === "remote" && address.trim() !== active.address)) && (
        <Button
          variant="secondary"
          size="default"
          onClick={() => {
            setActive({ mode, address: address.trim() });
            setEnabled(true);
          }}
        >
          Connect
        </Button>
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
export const ThisComputer: StoryObj<MiyoConnectionPanelProps> = { render: InteractiveConnection };
export const RemoteSetup: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "remote" },
  render: InteractiveConnection,
};
export const ConnectedRemote: StoryObj<MiyoConnectionPanelProps> = {
  args: {
    mode: "remote",
    address: "http://miyo-home:8742",
    message: "Current vault isn't confirmed on this server. Manage folders on the Miyo host.",
    children: <></>,
    connectionStatus: (
      <MiyoConnectionControl
        enabled
        status="available"
        remote
        checking={false}
        onDisconnect={() => {}}
        onRetry={() => {}}
      />
    ),
  },
  render: InteractiveConnection,
};
export const UnreachableRemote: StoryObj<MiyoConnectionPanelProps> = {
  args: {
    mode: "remote",
    address: "http://miyo-home:8742",
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
  args: { mode: "local" },
  render: ConnectedDraft,
};
export const EditingConnectedRemoteAddress: StoryObj<MiyoConnectionPanelProps> = {
  args: { mode: "remote", address: "http://miyo-work:8742" },
  render: ConnectedDraft,
};
