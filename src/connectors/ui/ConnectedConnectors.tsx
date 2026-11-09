import { CONNECTOR_SERVICES, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type {
  ConnectionState,
  ConnectionStatus,
  ConnectorsSnapshot,
} from "@/connectors/connectionManager";
import type { ServiceToolInfo } from "@/connectors/connectorTools";
import type {
  CustomConnectorState,
  CustomConnectorStatus,
} from "@/connectors/custom/customConnectors";
import {
  ConnectedStatus,
  ConnectorRow,
  FailedLoginStatus,
  LoginButton,
  RowMenu,
  StatusLine,
  WaitingConnectorRow,
} from "@/connectors/ui/ConnectorRow";
import {
  CustomConnectorRow,
  type CustomConnectorActions,
} from "@/connectors/ui/CustomConnectorRow";
import { Button } from "@/components/ui/button";
import { ChevronRight, Lock, Plug, Plus, RotateCw, Unplug } from "lucide-react";
import React, { useState } from "react";
import { cn } from "@/lib/utils";

const LIST_CLASS = cn("tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0");

const STATUS_ORDER: Record<ConnectionStatus, number> = {
  "needs-login": 0,
  unreachable: 1,
  connected: 2,
};

const CUSTOM_STATUS_ORDER: Record<CustomConnectorStatus["kind"], number> = {
  "couldnt-start": 0,
  "key-not-accepted": 0,
  "needs-key": 0,
  unreachable: 1,
  connected: 2,
  starting: 2,
  idle: 2,
  off: 3,
};

export interface ConnectedConnectorsProps {
  snapshot: ConnectorsSnapshot;
  customConnectors: readonly CustomConnectorState[];
  toolsByConnection: ReadonlyMap<string, readonly ServiceToolInfo[]>;
  onBrowse: () => void;
  onAddCustom: () => void;
  onConnect: (serviceId: string) => void;
  onReconnect: (connectionId: string) => void;
  onCheckAgain: (connectionId: string) => Promise<void>;
  onDisconnect: (connectionId: string) => void;
  onShowTools: (connectionId: string) => void;
  customActions: CustomConnectorActions;
}

export function ConnectedConnectors({
  snapshot,
  customConnectors,
  onBrowse,
  onAddCustom,
  onConnect,
  customActions,
  ...actions
}: ConnectedConnectorsProps): React.ReactElement {
  const listed = [
    ...snapshot.connections.flatMap((connection) => {
      const service = CONNECTOR_SERVICES.get(connection.serviceId);
      if (!service) return [];
      const row = (
        <ConnectedRow
          key={connection.id}
          connection={connection}
          service={service}
          snapshot={snapshot}
          {...actions}
        />
      );
      return [{ order: STATUS_ORDER[connection.status], name: service.name, row }];
    }),
    ...customConnectors.map((connector) => ({
      order: CUSTOM_STATUS_ORDER[connector.status.kind],
      name: connector.config.name,
      row: (
        <CustomConnectorRow
          key={`custom-${connector.config.id}`}
          connector={connector}
          {...customActions}
        />
      ),
    })),
  ].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const firstLogin = firstLoginRow(snapshot, onConnect);

  if (listed.length === 0) {
    return (
      <>
        {firstLogin && <ul className={LIST_CLASS}>{firstLogin}</ul>}
        <ConnectorsEmptyState onBrowse={onBrowse} onAddCustom={onAddCustom} />
      </>
    );
  }

  return (
    <section className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-basis-64 tw-flex-col tw-gap-1">
          <div role="heading" aria-level={2} className="tw-break-words tw-text-xl tw-font-bold">
            Connectors
          </div>
          <p className="tw-m-0 tw-text-sm tw-text-muted">Connect agents with external services.</p>
        </div>
        <Button className="tw-max-w-full" onClick={onBrowse}>
          <Plus className="tw-size-4" />
          <span className="tw-truncate">Browse connectors</span>
        </Button>
      </div>
      <ul className={LIST_CLASS}>
        {firstLogin}
        {listed.map(({ row }) => row)}
      </ul>
      <Button variant="ghost2" size="sm" className="tw-self-start" onClick={onAddCustom}>
        <Plus className="tw-size-icon-xs" />
        Add custom connector
      </Button>
    </section>
  );
}

// A first login has no connection to show it on until it succeeds, so reopening settings mid-login lost its Cancel and its failure reason.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/858
function firstLoginRow(
  { connections, waitingLogin, failedLogin }: ConnectorsSnapshot,
  onConnect: (serviceId: string) => void
): React.ReactElement | null {
  const isFirst = ({ connectionId }: { connectionId: string }) =>
    !connections.some(({ id }) => id === connectionId);
  const service = CONNECTOR_SERVICES.get((waitingLogin ?? failedLogin)?.serviceId ?? "");
  if (!service) return null;
  if (waitingLogin) {
    return isFirst(waitingLogin) ? (
      <WaitingConnectorRow service={service} waitingLogin={waitingLogin} />
    ) : null;
  }
  if (!failedLogin || !isFirst(failedLogin)) return null;
  return (
    <ConnectorRow
      service={service}
      detail={<FailedLoginStatus service={service} failedLogin={failedLogin} />}
      actions={
        <Button size="sm" variant="secondary" onClick={() => onConnect(service.id)}>
          Try again
        </Button>
      }
    />
  );
}

interface ConnectedRowProps extends Pick<
  ConnectedConnectorsProps,
  "snapshot" | "toolsByConnection" | "onReconnect" | "onCheckAgain" | "onDisconnect" | "onShowTools"
> {
  connection: ConnectionState;
  service: ConnectorCatalogEntry;
}

function ConnectedRow({
  connection,
  service,
  snapshot: { waitingLogin, failedLogin },
  toolsByConnection,
  onReconnect,
  onCheckAgain,
  onDisconnect,
  onShowTools,
}: ConnectedRowProps): React.ReactElement {
  // The check reads the stored login before contacting the service, so the row would show Connected while the service is still down.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/858
  const [checking, setChecking] = useState(false);
  if (waitingLogin?.connectionId === connection.id) {
    return <WaitingConnectorRow service={service} waitingLogin={waitingLogin} />;
  }
  const blockedBy = waitingLogin
    ? (CONNECTOR_SERVICES.get(waitingLogin.serviceId)?.name ?? null)
    : null;
  const reconnect = () => onReconnect(connection.id);

  let detail: React.ReactNode;
  let action: React.ReactNode = null;
  if (failedLogin?.connectionId === connection.id) {
    detail = <FailedLoginStatus service={service} failedLogin={failedLogin} />;
    action = (
      <LoginButton variant="secondary" blockedBy={blockedBy} onClick={reconnect}>
        Try again
      </LoginButton>
    );
  } else if (connection.status === "needs-login") {
    detail = <StatusLine tone="attention">Needs login</StatusLine>;
    action = (
      <LoginButton blockedBy={blockedBy} onClick={reconnect}>
        Reconnect
      </LoginButton>
    );
  } else if (connection.status === "unreachable" || checking) {
    detail = (
      <StatusLine tone="idle">
        Couldn&apos;t reach {service.name} just now. Copilot tries again in your next chat.
      </StatusLine>
    );
    action = (
      <Button
        size="sm"
        variant="secondary"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          void onCheckAgain(connection.id).finally(() => setChecking(false));
        }}
      >
        Try again
      </Button>
    );
  } else {
    detail = (
      <ConnectedStatus
        accountLabel={connection.accountLabel}
        toolCount={toolsByConnection.get(connection.id)?.length ?? null}
        onShowTools={() => onShowTools(connection.id)}
      />
    );
  }

  return (
    <ConnectorRow
      service={service}
      detail={detail}
      actions={
        <>
          {action}
          <RowMenu
            name={service.name}
            items={[
              {
                label: "Reconnect",
                icon: <RotateCw />,
                onSelect: reconnect,
                disabled: blockedBy !== null,
              },
              {
                label: "Disconnect",
                icon: <Unplug />,
                onSelect: () => onDisconnect(connection.id),
                opensDialog: true,
                destructive: true,
              },
            ]}
          />
        </>
      }
    />
  );
}

interface ConnectorsEmptyStateProps {
  onBrowse: () => void;
  onAddCustom: () => void;
}

function ConnectorsEmptyState({
  onBrowse,
  onAddCustom,
}: ConnectorsEmptyStateProps): React.ReactElement {
  return (
    <section className="tw-flex tw-flex-col tw-items-center tw-gap-3 tw-px-4 tw-py-12 tw-text-center">
      <div
        aria-hidden="true"
        className="tw-mb-2 tw-flex tw-size-12 tw-items-center tw-justify-center tw-rounded-xl tw-bg-interactive-accent tw-text-on-accent"
      >
        <Plug className="tw-size-6" />
      </div>
      <div role="heading" aria-level={2} className="tw-text-xl tw-font-semibold">
        Connect the services you work in
      </div>
      <p className="tw-m-0 tw-max-w-md tw-text-sm tw-text-muted">
        Let Claude, Codex and OpenCode read and update Notion, Linear, Jira, Todoist and more. Log
        in once and every agent can use it.
      </p>
      <div className="tw-mt-2 tw-flex tw-max-w-full tw-flex-wrap tw-justify-center tw-gap-2">
        <Button className="tw-max-w-full" onClick={onBrowse}>
          Browse connectors
          <ChevronRight className="tw-size-4" />
        </Button>
        <Button variant="secondary" className="tw-max-w-full" onClick={onAddCustom}>
          <span className="tw-truncate">Add custom connector</span>
        </Button>
      </div>
      <p className="tw-m-0 tw-mt-1 tw-flex tw-items-center tw-gap-1.5 tw-text-ui-smaller tw-text-muted">
        <Lock aria-hidden="true" className="tw-size-3" />
        Logins stay in this device&apos;s keychain. Copilot never sees your password.
      </p>
    </section>
  );
}
