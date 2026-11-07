import {
  CustomConnectorChatCardView,
  type CustomConnectorChatCardViewProps,
} from "@/connectors/ui/CustomConnectorChatCard";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

const FAKE_NOTES = {
  id: "fakenotes",
  name: "Fake Notes",
  command: "node",
  args: ["/Users/me/Developer/servers/fake-notes/build/stdio-server.mjs", "--store", "~/notes"],
  envNames: ["FAKE_KEY"],
};

const meta = {
  title: "Connectors/Custom Connector Chat Card",
  component: CustomConnectorChatCardView,
  args: {
    proposal: FAKE_NOTES,
    locked: false,
    updating: false,
    storedValueNames: new Set<string>(),
    status: null,
    onAdd: () => undefined,
    onDismiss: () => undefined,
    onSeePlans: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<CustomConnectorChatCardViewProps>;
export default meta;

type Story = StoryObj<CustomConnectorChatCardViewProps>;

export const ProposeLocal: Story = {};

export const ProposeRemoteWithKeys: Story = {
  args: {
    proposal: {
      id: "acmedocs",
      name: "Acme Docs",
      url: "https://mcp.acme.example.com/v1/mcp?workspace=research-team",
      headerNames: ["Authorization", "X-Acme-Workspace-Token"],
    },
  },
};

export const ProposeUpdate: Story = {
  args: {
    proposal: { ...FAKE_NOTES, args: [...FAKE_NOTES.args, "--fixed"] },
    updating: true,
    storedValueNames: new Set(["FAKE_KEY"]),
  },
};

export const Starting: Story = {
  args: { status: { kind: "starting" } },
};

export const Connected: Story = {
  args: { status: { kind: "connected", toolCount: 2 } },
};

export const CouldNotStart: Story = {
  args: {
    status: {
      kind: "couldnt-start",
      reason:
        "Error: Cannot find module '/Users/me/Developer/servers/fake-notes/build/stdio-server.mjs'",
    },
  },
};

export const CouldNotReach: Story = {
  args: {
    proposal: {
      id: "acmedocs",
      name: "Acme Docs",
      url: "https://mcp.acme.example.com/v1/mcp",
      headerNames: ["Authorization"],
    },
    status: { kind: "unreachable", reason: "getaddrinfo ENOTFOUND mcp.acme.example.com" },
  },
};

export const KeyNotAccepted: Story = {
  args: { status: { kind: "key-not-accepted" } },
};

export const NotASupporter: Story = {
  args: { locked: true },
};

function DismissDemo(props: CustomConnectorChatCardViewProps): React.ReactElement {
  const [dismissed, setDismissed] = useState(false);
  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-text-sm">
      <div className="tw-px-3">
        Fake Notes needs FAKE_KEY. Type it into the card below, then click Add.
      </div>
      {dismissed ? null : (
        <CustomConnectorChatCardView {...props} onDismiss={() => setDismissed(true)} />
      )}
    </div>
  );
}

export const DismissWithNotNow: Story = {
  render: (props) => <DismissDemo {...meta.args} {...props} />,
};
