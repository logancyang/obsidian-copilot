import type { ConnectorCategory } from "@/connectors/catalog";
import type { ConnectorsSnapshot, WaitingLogin } from "@/connectors/connectionManager";
import { BrowseConnectors, type BrowseConnectorsProps } from "@/connectors/ui/BrowseConnectors";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";

const GRANOLA_WAITING: WaitingLogin = {
  connectionId: "new-1",
  serviceId: "granola",
  loginUrl: () => "https://granola.example/authorize?state=story",
  cancel: () => undefined,
};

function snapshotOf(rest: Partial<ConnectorsSnapshot> = {}): ConnectorsSnapshot {
  return {
    connections: [
      { id: "c1", serviceId: "granola", status: "connected" },
      { id: "c2", serviceId: "linear", status: "needs-login" },
    ],
    waitingLogin: null,
    failedLogin: null,
    needsAttention: true,
    ...rest,
  };
}

interface FilledInProps extends BrowseConnectorsProps {
  category?: ConnectorCategory;
  query?: string;
}

function FilledIn({ category, query, ...props }: FilledInProps) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const select = container.current?.querySelector("select");
    if (select && category) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        select,
        category
      );
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const input = container.current?.querySelector("input");
    if (input && query) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, [category, query]);
  return (
    <div ref={container} className="tw-h-[480px]">
      <BrowseConnectors {...props} />
    </div>
  );
}

const meta = {
  title: "Connectors/Browse",
  component: BrowseConnectors,
  args: {
    snapshot: snapshotOf(),
    onBack: () => undefined,
    onConnect: () => undefined,
    onReconnect: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<BrowseConnectorsProps>;
export default meta;

export const AllConnectors: StoryObj<BrowseConnectorsProps> = {
  render: (args) => <FilledIn {...(args as BrowseConnectorsProps)} />,
};

export const FilteredByCategory: StoryObj<BrowseConnectorsProps> = {
  render: (args) => <FilledIn {...(args as BrowseConnectorsProps)} category="Tasks & projects" />,
};

export const SearchingWithACategoryChosen: StoryObj<BrowseConnectorsProps> = {
  render: (args) => (
    <FilledIn {...(args as BrowseConnectorsProps)} category="Design" query="notes" />
  ),
};

export const LoginDidNotFinish: StoryObj<BrowseConnectorsProps> = {
  args: {
    snapshot: snapshotOf({
      failedLogin: { connectionId: "new-1", serviceId: "clickup", reason: "rejected" },
    }),
  },
  render: (args) => <FilledIn {...(args as BrowseConnectorsProps)} />,
};

export const SearchingWhileWaitingForBrowser: StoryObj<BrowseConnectorsProps> = {
  render: (args) => (
    <FilledIn
      {...(args as BrowseConnectorsProps)}
      snapshot={snapshotOf({ waitingLogin: GRANOLA_WAITING })}
      query="meeting"
    />
  ),
};

export const NoResults: StoryObj<BrowseConnectorsProps> = {
  render: (args) => <FilledIn {...(args as BrowseConnectorsProps)} query="gmail" />,
};
