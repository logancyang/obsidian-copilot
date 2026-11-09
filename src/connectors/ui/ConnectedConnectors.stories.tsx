import type {
  ConnectionState,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
import type { CustomConnectorState } from "@/connectors/custom/customConnectors";
import {
  ConnectedConnectors,
  type ConnectedConnectorsProps,
} from "@/connectors/ui/ConnectedConnectors";
import { FAKE_CUSTOM_TOOLS, NOTION_TOOLS } from "@/connectors/ui/testing/serviceTools";
import type { Meta, StoryObj } from "@/lib/story";

const EVERY_STATUS: ConnectionState[] = [
  { id: "c1", serviceId: "notion", status: "connected", accountLabel: "Acme workspace" },
  { id: "c2", serviceId: "granola", status: "connected" },
  { id: "c3", serviceId: "linear", status: "needs-login" },
  { id: "c4", serviceId: "todoist", status: "needs-login" },
  { id: "c5", serviceId: "miro", status: "unreachable" },
];

const CUSTOM_EVERY_STATUS: CustomConnectorState[] = [
  {
    config: { id: "github", name: "GitHub", command: "npx", args: [], envNames: ["TOKEN"] },
    status: { kind: "connected", tools: [...NOTION_TOOLS, ...NOTION_TOOLS, ...FAKE_CUSTOM_TOOLS] },
  },
  {
    config: { id: "time", name: "Time", command: "uvx", args: [], envNames: [] },
    status: { kind: "connected", tools: [] },
  },
  {
    config: { id: "memory", name: "Memory", command: "npx", args: [], envNames: [] },
    status: { kind: "starting" },
  },
  {
    config: { id: "sqlite", name: "SQLite", command: "uvx", args: [], envNames: [] },
    status: { kind: "idle" },
  },
  {
    config: { id: "postgres", name: "Postgres", command: "npx", args: [], envNames: ["URL"] },
    status: {
      kind: "couldnt-start",
      reason: "Error: connect ECONNREFUSED 127.0.0.1:5432 while connecting to the database",
    },
  },
  {
    config: { id: "acmedocs", name: "Acme Docs", url: "https://mcp.acme.test", headerNames: [] },
    status: {
      kind: "unreachable",
      reason:
        "HTTP 404: <!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>",
    },
  },
  {
    config: { id: "linearapi", name: "Linear API", url: "https://a.test", headerNames: ["Key"] },
    status: { kind: "key-not-accepted" },
  },
  {
    config: { id: "brave", name: "Brave Search", command: "npx", args: [], envNames: ["KEY"] },
    status: { kind: "needs-key" },
  },
  {
    config: { id: "fetch", name: "Fetch", command: "uvx", args: [], envNames: [] },
    status: { kind: "off" },
  },
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
    customConnectors: [],
    toolsByConnection: new Map([["c1", NOTION_TOOLS]]),
    onBrowse: () => undefined,
    onAddCustom: () => undefined,
    customActions: {
      onEdit: () => undefined,
      onTryAgain: () => undefined,
      onSetTurnedOff: () => undefined,
      onRemove: () => undefined,
      onShowTools: () => undefined,
    },
    onConnect: () => undefined,
    onReconnect: () => undefined,
    onCheckAgain: async () => undefined,
    onDisconnect: () => undefined,
    onShowTools: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ConnectedConnectorsProps>;
export default meta;

export const NothingConnected: StoryObj<ConnectedConnectorsProps> = {
  args: { snapshot: snapshotOf({ connections: [], needsAttention: false }) },
};

export const EveryRowState: StoryObj<ConnectedConnectorsProps> = {};

export const CustomConnectorsInEveryStatus: StoryObj<ConnectedConnectorsProps> = {
  args: {
    snapshot: snapshotOf({
      connections: [{ id: "c1", serviceId: "notion", status: "connected" }],
      needsAttention: false,
    }),
    customConnectors: CUSTOM_EVERY_STATUS,
  },
};

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
