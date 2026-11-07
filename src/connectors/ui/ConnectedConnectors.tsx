import { CONNECTOR_SERVICES, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type {
  ConnectionState,
  ConnectionStatus,
  ConnectorsSnapshot,
} from "@/connectors/connectionManager";
import {
  ConnectorRow,
  FailedLoginStatus,
  LoginButton,
  StatusLine,
  WaitingConnectorRow,
} from "@/connectors/ui/ConnectorRow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronRight, Lock, MoreHorizontal, Plug, Plus, RotateCw, Unplug } from "lucide-react";
import React, { useRef, useState } from "react";

const LIST_CLASS = "tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0";

const STATUS_ORDER: Record<ConnectionStatus, number> = {
  "needs-login": 0,
  unreachable: 1,
  connected: 2,
};

export interface ConnectedConnectorsProps {
  snapshot: ConnectorsSnapshot;
  onBrowse: () => void;
  onConnect: (serviceId: string) => void;
  onReconnect: (connectionId: string) => void;
  onCheckAgain: (connectionId: string) => Promise<void>;
  onDisconnect: (connectionId: string) => void;
}

export function ConnectedConnectors({
  snapshot,
  onBrowse,
  onConnect,
  ...actions
}: ConnectedConnectorsProps): React.ReactElement {
  const listed = snapshot.connections
    .flatMap((connection) => {
      const service = CONNECTOR_SERVICES.get(connection.serviceId);
      return service ? [{ connection, service }] : [];
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.connection.status] - STATUS_ORDER[b.connection.status] ||
        a.service.name.localeCompare(b.service.name)
    );

  const firstLogin = firstLoginRow(snapshot, onConnect);

  if (listed.length === 0) {
    return (
      <>
        {firstLogin && <ul className={LIST_CLASS}>{firstLogin}</ul>}
        <ConnectorsEmptyState onBrowse={onBrowse} />
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
        {listed.map(({ connection, service }) => (
          <ConnectedRow
            key={connection.id}
            connection={connection}
            service={service}
            snapshot={snapshot}
            {...actions}
          />
        ))}
      </ul>
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

interface ConnectedRowProps extends Omit<ConnectedConnectorsProps, "onBrowse" | "onConnect"> {
  connection: ConnectionState;
  service: ConnectorCatalogEntry;
}

function ConnectedRow({
  connection,
  service,
  snapshot: { waitingLogin, failedLogin },
  onReconnect,
  onCheckAgain,
  onDisconnect,
}: ConnectedRowProps): React.ReactElement {
  const menuContainer = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const disconnectOnMenuClose = useRef(false);
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
      <StatusLine tone="ok">
        {connection.accountLabel ? `Connected · ${connection.accountLabel}` : "Connected"}
      </StatusLine>
    );
  }

  return (
    <ConnectorRow
      service={service}
      detail={detail}
      actions={
        <>
          {action}
          <div ref={menuContainer}>
            <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost2"
                  size="icon"
                  aria-label={`More actions for ${service.name}`}
                  title="More actions"
                >
                  <MoreHorizontal className="tw-size-4" />
                </Button>
              </DropdownMenuTrigger>
              {/* A menu outside the settings modal loses focus to the modal, which closes it at once.
                https://github.com/Brevilabs/obsidian-copilot-private/issues/858 */}
              <DropdownMenuContent
                align="end"
                container={menuContainer.current}
                onCloseAutoFocus={(event) => {
                  if (!disconnectOnMenuClose.current) return;
                  disconnectOnMenuClose.current = false;
                  // A confirm opened while the menu was still mounted lost focus to the menu, then to the settings popout, so Enter did nothing.
                  // https://github.com/Brevilabs/obsidian-copilot-private/issues/858
                  event.preventDefault();
                  onDisconnect(connection.id);
                }}
              >
                <DropdownMenuItem disabled={blockedBy !== null} onSelect={reconnect}>
                  <RotateCw />
                  Reconnect
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-text-error focus:tw-text-error"
                  onSelect={() => {
                    disconnectOnMenuClose.current = true;
                  }}
                >
                  <Unplug />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      }
    />
  );
}

interface ConnectorsEmptyStateProps {
  onBrowse: () => void;
}

function ConnectorsEmptyState({ onBrowse }: ConnectorsEmptyStateProps): React.ReactElement {
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
      <Button className="tw-mt-2" onClick={onBrowse}>
        Browse connectors
        <ChevronRight className="tw-size-4" />
      </Button>
      <p className="tw-m-0 tw-mt-1 tw-flex tw-items-center tw-gap-1.5 tw-text-ui-smaller tw-text-muted">
        <Lock aria-hidden="true" className="tw-size-3" />
        Logins stay in this device&apos;s keychain. Copilot never sees your password.
      </p>
    </section>
  );
}
