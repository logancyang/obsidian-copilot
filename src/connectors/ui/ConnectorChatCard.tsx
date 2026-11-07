import { CONNECTOR_SERVICES, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type {
  ConnectionManager,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
import {
  ensureConnectorsEntitlement,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import { loginFailureMessage } from "@/connectors/oauth/connectorAuth";
import { ConnectorLogo } from "@/connectors/ui/ConnectorLogo";
import { LoginButton, TextButton } from "@/connectors/ui/ConnectorRow";
import { useConnectorsSnapshot } from "@/connectors/ui/useConnectorsSnapshot";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/utils";
import { navigateToPlusPage } from "@/plusUtils";
import { err2String } from "@/utils";
import { Check, Copy, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React from "react";

export interface ConnectorChatCardProps {
  serviceId: string;
  manager: ConnectionManager;
  onDismiss: () => void;
}

export function ConnectorChatCard({
  serviceId,
  manager,
  onDismiss,
}: ConnectorChatCardProps): React.ReactElement | null {
  const app = useApp();
  const snapshot = useConnectorsSnapshot(manager);
  const enabled = useIsConnectorsEnabled();
  if (!snapshot) return null;

  const logIn = async (connectionId: string | undefined) => {
    if (!(await ensureConnectorsEntitlement(app))) return;
    await (connectionId ? manager.reconnect(connectionId) : manager.connect(serviceId));
  };
  return (
    <ConnectorChatCardView
      serviceId={serviceId}
      snapshot={snapshot}
      locked={enabled === false}
      onLogIn={(connectionId) => {
        logIn(connectionId).catch((error) => new Notice(err2String(error)));
      }}
      onDismiss={onDismiss}
      onSeePlans={() => navigateToPlusPage("connectors_chat")}
    />
  );
}

export interface ConnectorChatCardViewProps {
  serviceId: string;
  snapshot: ConnectorsSnapshot;
  locked: boolean;
  onLogIn: (connectionId: string | undefined) => void;
  onDismiss: () => void;
  onSeePlans: () => void;
}

export function ConnectorChatCardView({
  serviceId,
  snapshot,
  locked,
  onLogIn,
  onDismiss,
  onSeePlans,
}: ConnectorChatCardViewProps): React.ReactElement | null {
  const service = CONNECTOR_SERVICES.get(serviceId);
  if (!service) return null;
  const { name } = service;
  const connection = snapshot.connections.find((candidate) => candidate.serviceId === serviceId);
  const { waitingLogin, failedLogin } = snapshot;
  const waiting = waitingLogin?.serviceId === serviceId ? waitingLogin : null;
  const failed = failedLogin?.serviceId === serviceId ? failedLogin : null;
  const blockedBy =
    waitingLogin && !waiting
      ? (CONNECTOR_SERVICES.get(waitingLogin.serviceId)?.name ?? null)
      : null;
  const title =
    connection?.status === "needs-login" ? `Your ${name} login expired` : `Connect ${name}`;

  // One card follows the login through every state (plans for non-Supporters, waiting, connected, didn't finish, expired), so the user connects without leaving the chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
  if (locked) {
    return (
      <Card
        service={service}
        tone="accent"
        title={`Connect ${name} with Connectors`}
        detail={<span className="tw-text-muted">Connectors is a preview for Supporters.</span>}
        actions={
          <Button size="sm" onClick={onSeePlans}>
            See plans
          </Button>
        }
      />
    );
  }
  if (waiting) {
    return (
      <Card
        service={service}
        tone="accent"
        title={title}
        detail={<WaitingStatus />}
        actions={
          <Button size="sm" variant="secondary" onClick={() => waiting.cancel()}>
            Cancel
          </Button>
        }
        footer={<CopyLoginLinkButton waitingLogin={waiting} />}
      />
    );
  }
  if (connection?.status === "connected") {
    return (
      <div
        className={cn(
          CARD,
          "tw-gap-2.5 tw-border-transparent tw-bg-success tw-py-2.5 tw-text-success"
        )}
      >
        <Check aria-hidden="true" className="tw-size-4 tw-shrink-0" />
        <span className="tw-flex-1">{name} connected. Every agent can use it now.</span>
      </div>
    );
  }
  if (failed) {
    return (
      <Card
        service={service}
        title={title}
        detail={<span className="tw-text-error">{loginFailureMessage(failed.reason, name)}</span>}
        actions={
          <LoginButton
            blockedBy={blockedBy}
            variant="secondary"
            onClick={() => onLogIn(connection?.id)}
          >
            Try again
          </LoginButton>
        }
      />
    );
  }
  // An outage keeps the login, so asking the user to log in again would send them through OAuth for nothing.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
  if (connection?.status === "unreachable") {
    return (
      <Card
        service={service}
        title={`Couldn't reach ${name}`}
        detail={<span className="tw-text-muted">Copilot tries again in your next chat.</span>}
        actions={null}
      />
    );
  }
  if (connection) {
    return (
      <Card
        service={service}
        tone="error"
        title={title}
        detail={<span className="tw-text-muted">Reconnect, then ask the agent to try again.</span>}
        actions={
          <LoginButton blockedBy={blockedBy} onClick={() => onLogIn(connection.id)}>
            Reconnect
          </LoginButton>
        }
      />
    );
  }
  return (
    <Card
      service={service}
      title={title}
      detail={
        <span className="tw-text-muted">
          Log in once and every agent can use your {name} account.
        </span>
      }
      actions={
        <>
          <Button size="sm" variant="ghost2" onClick={onDismiss}>
            Not now
          </Button>
          <LoginButton blockedBy={blockedBy} onClick={() => onLogIn(undefined)}>
            Connect
          </LoginButton>
        </>
      }
    />
  );
}

const CARD =
  "tw-mx-3 tw-my-2 tw-flex tw-items-center tw-rounded-md tw-border tw-border-solid tw-px-3.5 tw-py-3 tw-text-sm";

const TONES = {
  normal: "tw-border-border tw-bg-secondary",
  accent: "tw-border-interactive-accent tw-bg-interactive-accent-hsl/10",
  error: "tw-border-border tw-bg-modifier-error-rgb/10",
};

interface CardProps {
  service: ConnectorCatalogEntry;
  title: string;
  tone?: keyof typeof TONES;
  detail: React.ReactNode;
  actions: React.ReactNode;
  footer?: React.ReactNode;
}

function Card({ service, title, tone = "normal", detail, actions, footer }: CardProps) {
  return (
    <div className={cn(CARD, "tw-flex-col tw-items-stretch tw-gap-2", TONES[tone])}>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
        <ConnectorLogo service={service} className="tw-size-9" />
        <div className="tw-min-w-0 tw-flex-1 tw-basis-40">
          <div className="tw-font-semibold tw-text-normal">{title}</div>
          <div className="tw-text-ui-smaller">{detail}</div>
        </div>
        <div className="tw-ml-auto tw-flex tw-shrink-0 tw-items-center tw-gap-1">{actions}</div>
      </div>
      {footer}
    </div>
  );
}

function WaitingStatus(): React.ReactElement {
  return (
    <div
      role="status"
      className="tw-flex tw-items-center tw-gap-1.5 tw-text-ui-smaller tw-text-accent"
    >
      <Loader2 aria-hidden="true" className="tw-size-3 tw-shrink-0 tw-animate-spin" />
      Finish logging in in your browser…
    </div>
  );
}

function CopyLoginLinkButton({ waitingLogin }: { waitingLogin: WaitingLogin }): React.ReactElement {
  const { isCopied, copy } = useCopyToClipboard();
  return (
    <TextButton
      className="tw-ml-12 tw-self-start tw-whitespace-normal tw-text-left"
      onClick={() => {
        const url = waitingLogin.loginUrl();
        if (url) copy(url);
      }}
    >
      <Copy aria-hidden="true" className="tw-size-3" />
      {isCopied ? "Copied" : "No browser window? Copy the login link"}
    </TextButton>
  );
}
