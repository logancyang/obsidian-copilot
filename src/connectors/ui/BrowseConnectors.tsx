import {
  CONNECTOR_CATALOG,
  CONNECTOR_CATEGORIES,
  CONNECTOR_SERVICES,
  type ConnectorCatalogEntry,
  type ConnectorCategory,
} from "@/connectors/catalog";
import type { ConnectorsSnapshot } from "@/connectors/connectionManager";
import { connectorRequestUrl } from "@/connectors/connectorLinks";
import { findConnectors } from "@/connectors/connectorSearch";
import {
  ConnectorRow,
  FailedLoginStatus,
  LoginButton,
  StatusLine,
  WaitingConnectorRow,
} from "@/connectors/ui/ConnectorRow";
import { Button } from "@/components/ui/button";
import { ObsidianNativeSelect, type SelectOption } from "@/components/ui/obsidian-native-select";
import { SearchBar } from "@/components/ui/SearchBar";
import { SettingsSubPageLayout } from "@/settings/v2/components/ui/SettingsSubPageLayout";
import { Check, ExternalLink, Search } from "lucide-react";
import React, { useMemo, useState } from "react";

const CATEGORY_OPTIONS: SelectOption[] = [
  { label: "All", value: "" },
  ...CONNECTOR_CATEGORIES.map((category) => ({ label: category, value: category })),
];

export interface BrowseConnectorsProps {
  snapshot: ConnectorsSnapshot;
  onBack: () => void;
  onConnect: (serviceId: string) => void;
  onReconnect: (connectionId: string) => void;
}

export function BrowseConnectors({
  snapshot,
  onBack,
  ...actions
}: BrowseConnectorsProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectorCategory | null>(null);
  const found = useMemo(
    () => findConnectors(CONNECTOR_CATALOG, query, category),
    [query, category]
  );
  const searching = query.trim().length > 0;
  const { waitingLogin } = snapshot;
  // A login's Cancel and link recovery live on its row, and a waiting login blocks every other Connect, so filtering its row away left no way out.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/858
  const hiddenWaitingService =
    waitingLogin && !found.some(({ id }) => id === waitingLogin.serviceId)
      ? CONNECTOR_SERVICES.get(waitingLogin.serviceId)
      : undefined;

  return (
    <SettingsSubPageLayout
      title="Browse connectors"
      onBack={onBack}
      titleAction={
        !searching && (
          <ObsidianNativeSelect
            aria-label="Category"
            options={CATEGORY_OPTIONS}
            value={category ?? ""}
            onChange={(event) =>
              setCategory(CONNECTOR_CATEGORIES.find((c) => c === event.target.value) ?? null)
            }
            containerClassName="tw-w-auto tw-max-w-full"
          />
        )
      }
      toolbar={
        <>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search connectors, or what you want to do (tasks, meetings…)"
          />
          {searching && found.length > 0 && (
            <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
              {found.length} {found.length === 1 ? "connector matches" : "connectors match"} “
              {query.trim()}”
            </p>
          )}
        </>
      }
      footer={
        <>
          {waitingLogin && hiddenWaitingService && (
            <ul className="tw-m-0 tw-list-none tw-p-0">
              <WaitingConnectorRow service={hiddenWaitingService} waitingLogin={waitingLogin} />
            </ul>
          )}
          {found.length > 0 && (
            <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
              Don&apos;t see your service?{" "}
              <a href={connectorRequestUrl()} target="_blank" rel="noopener noreferrer">
                Request a connector
              </a>
            </p>
          )}
        </>
      }
    >
      {found.length === 0 ? (
        <NoConnectorFound query={query.trim()} />
      ) : (
        <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-px-0 tw-py-4">
          {found.map((service) => (
            <CatalogRow key={service.id} service={service} snapshot={snapshot} {...actions} />
          ))}
        </ul>
      )}
    </SettingsSubPageLayout>
  );
}

interface CatalogRowProps extends Omit<BrowseConnectorsProps, "onBack"> {
  service: ConnectorCatalogEntry;
}

function CatalogRow({
  service,
  snapshot: { connections, waitingLogin, failedLogin },
  onConnect,
  onReconnect,
}: CatalogRowProps): React.ReactElement {
  if (waitingLogin?.serviceId === service.id) {
    return <WaitingConnectorRow service={service} waitingLogin={waitingLogin} />;
  }
  const blockedBy = waitingLogin
    ? (CONNECTOR_SERVICES.get(waitingLogin.serviceId)?.name ?? null)
    : null;
  const connection = connections.find(({ serviceId }) => serviceId === service.id);
  const login = () => (connection ? onReconnect(connection.id) : onConnect(service.id));

  if (failedLogin?.serviceId === service.id) {
    return (
      <ConnectorRow
        service={service}
        detail={<FailedLoginStatus service={service} failedLogin={failedLogin} />}
        actions={
          <LoginButton variant="secondary" blockedBy={blockedBy} onClick={login}>
            Try again
          </LoginButton>
        }
      />
    );
  }

  let actions: React.ReactNode;
  if (!connection) {
    actions = (
      <LoginButton variant="secondary" blockedBy={blockedBy} onClick={login}>
        Connect
      </LoginButton>
    );
  } else if (connection.status === "needs-login") {
    actions = (
      <>
        <StatusLine tone="attention">Needs login</StatusLine>
        <LoginButton blockedBy={blockedBy} onClick={login}>
          Reconnect
        </LoginButton>
      </>
    );
  } else {
    actions = (
      <span className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-1 tw-text-success">
        <Check aria-hidden="true" className="tw-size-3.5" />
        Connected
      </span>
    );
  }
  return (
    <ConnectorRow
      service={service}
      detail={service.description}
      actions={
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-text-ui-smaller">
          {actions}
        </div>
      }
    />
  );
}

interface NoConnectorFoundProps {
  query: string;
}

function NoConnectorFound({ query }: NoConnectorFoundProps): React.ReactElement {
  const serviceName = query.charAt(0).toUpperCase() + query.slice(1);
  return (
    <section className="tw-flex tw-flex-col tw-items-center tw-gap-2 tw-px-4 tw-py-10 tw-text-center">
      <Search aria-hidden="true" className="tw-size-6 tw-text-muted" />
      <div role="heading" aria-level={3} className="tw-text-base tw-font-semibold">
        No connector for “{query}” yet
      </div>
      <p className="tw-m-0 tw-max-w-sm tw-text-sm tw-text-muted">
        Tell us which service you need. Requests decide what we add next.
      </p>
      <Button asChild className="tw-mt-2">
        <a
          href={connectorRequestUrl(serviceName)}
          target="_blank"
          rel="noopener noreferrer"
          className="tw-no-underline"
        >
          Request {serviceName}
          <ExternalLink aria-hidden="true" className="tw-size-4" />
        </a>
      </Button>
    </section>
  );
}
