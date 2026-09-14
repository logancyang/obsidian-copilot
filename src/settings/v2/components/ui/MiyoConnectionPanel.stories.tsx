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
        <MiyoConnectionControl
          enabled={false}
          status="unknown"
          remote={mode === "remote"}
          checking={false}
          connectLabel={mode === "remote" ? "Save and connect" : "Connect"}
          onConnect={() => {}}
          onDisconnect={() => {}}
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
    children: (
      <MiyoConnectionControl
        enabled
        status="available"
        remote
        checking={false}
        onConnect={() => {}}
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
