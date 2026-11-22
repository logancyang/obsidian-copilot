import type {
  ConnectionState,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
import {
  ConnectorChatCardView,
  type ConnectorChatCardViewProps,
} from "@/connectors/ui/ConnectorChatCard";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

const NOTION_WAITING: WaitingLogin = {
  connectionId: "c-notion",
  serviceId: "notion",
  loginUrl: () => "https://mcp.notion.com/authorize?state=story",
  cancel: () => undefined,
};

function snapshotOf(
  connections: ConnectionState[] = [],
  rest: Partial<ConnectorsSnapshot> = {}
): ConnectorsSnapshot {
  return {
    connections,
    waitingLogin: null,
    failedLogin: null,
    needsAttention: connections.some(({ status }) => status === "needs-login"),
    ...rest,
  };
}

const meta = {
  title: "Connectors/Chat Card",
  component: ConnectorChatCardView,
  args: {
    serviceId: "notion",
    snapshot: snapshotOf(),
    locked: false,
    onLogIn: () => undefined,
    onDismiss: () => undefined,
    onSeePlans: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ConnectorChatCardViewProps>;
export default meta;

type Story = StoryObj<ConnectorChatCardViewProps>;

export const Suggest: Story = {};

export const SuggestWhileAnotherLoginWaits: Story = {
  args: {
    snapshot: snapshotOf([], {
      waitingLogin: { ...NOTION_WAITING, connectionId: "c-linear", serviceId: "linear" },
    }),
  },
};

export const Waiting: Story = {
  args: { snapshot: snapshotOf([], { waitingLogin: NOTION_WAITING }) },
};

export const Reconnect: Story = {
  args: {
    serviceId: "linear",
    snapshot: snapshotOf([{ id: "c-linear", serviceId: "linear", status: "needs-login" }]),
  },
};

export const CouldNotReach: Story = {
  args: {
    snapshot: snapshotOf([{ id: "c-notion", serviceId: "notion", status: "unreachable" }]),
  },
};

export const Connected: Story = {
  args: {
    snapshot: snapshotOf([{ id: "c-notion", serviceId: "notion", status: "connected" }]),
  },
};

export const LoginDidNotFinish: Story = {
  args: {
    snapshot: snapshotOf([], {
      failedLogin: {
        connectionId: "c-notion",
        serviceId: "notion",
        reason: "cancelled-on-service",
      },
    }),
  },
};

export const NotASupporter: Story = {
  args: { locked: true },
};

function DismissDemo(props: ConnectorChatCardViewProps): React.ReactElement {
  const [dismissed, setDismissed] = useState(false);
  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-text-sm">
      <div className="tw-px-3">
        I can&apos;t reach Notion yet. Connect it and I&apos;ll pick this up.
      </div>
      {dismissed ? null : <ConnectorChatCardView {...props} onDismiss={() => setDismissed(true)} />}
    </div>
  );
}

export const DismissWithNotNow: Story = {
  render: (props) => <DismissDemo {...meta.args} {...props} />,
};
