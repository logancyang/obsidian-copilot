import type {
  ConnectionState,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
import {
  ConnectedConnectors,
  type ConnectedConnectorsProps,
} from "@/connectors/ui/ConnectedConnectors";
import type { Meta, StoryObj } from "@/lib/story";

const EVERY_STATUS: ConnectionState[] = [
  { id: "c1", serviceId: "notion", status: "connected", accountLabel: "Acme workspace" },
  { id: "c2", serviceId: "granola", status: "connected" },
  { id: "c3", serviceId: "linear", status: "needs-login" },
  { id: "c4", serviceId: "todoist", status: "needs-login" },
  { id: "c5", serviceId: "miro", status: "unreachable" },
];

const LINEAR_WAITING: WaitingLogin = {
  connectionId: "c3",
  serviceId: "linear",
  loginUrl: () => "https://linear.app/oauth/authorize?state=story",
  cancel: () => undefined,
};

function snapshotOf(rest: Partial<ConnectorsSnapshot> = {}): ConnectorsSnapshot {
  return {
    connections: EVERY_STATUS,
    waitingLogin: null,
    failedLogin: null,
    needsAttention: true,
    ...rest,
  };
}

const meta = {
  title: "Connectors/Connected List",
  component: ConnectedConnectors,
  args: {
    snapshot: snapshotOf(),
    onBrowse: () => undefined,
    onConnect: () => undefined,
    onReconnect: () => undefined,
    onCheckAgain: async () => undefined,
    onDisconnect: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ConnectedConnectorsProps>;
export default meta;

export const NothingConnected: StoryObj<ConnectedConnectorsProps> = {
  args: { snapshot: snapshotOf({ connections: [], needsAttention: false }) },
};

export const EveryRowState: StoryObj<ConnectedConnectorsProps> = {};

export const ReconnectWaitingForBrowser: StoryObj<ConnectedConnectorsProps> = {
  args: { snapshot: snapshotOf({ waitingLogin: LINEAR_WAITING }) },
};

export const ReconnectDidNotFinish: StoryObj<ConnectedConnectorsProps> = {
  args: {
    snapshot: snapshotOf({
      failedLogin: { connectionId: "c3", serviceId: "linear", reason: "rejected" },
    }),
  },
};

export const FirstLoginWaitingForBrowser: StoryObj<ConnectedConnectorsProps> = {
  args: {
    snapshot: snapshotOf({
      connections: [],
      needsAttention: false,
      waitingLogin: { ...LINEAR_WAITING, connectionId: "new", serviceId: "airtable" },
    }),
  },
};

export const FirstLoginDidNotFinish: StoryObj<ConnectedConnectorsProps> = {
  args: {
    snapshot: snapshotOf({
      failedLogin: { connectionId: "new", serviceId: "airtable", reason: "timed-out" },
    }),
  },
};
