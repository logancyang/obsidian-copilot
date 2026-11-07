import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import type { FailedLogin, WaitingLogin } from "@/connectors/connectionManager";
import { loginRejectedIssueUrl } from "@/connectors/connectorLinks";
import { loginFailureMessage } from "@/connectors/oauth/connectorAuth";
import { ConnectorLogo } from "@/connectors/ui/ConnectorLogo";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/utils";
import { AlertCircle, Copy, Loader2 } from "lucide-react";
import React from "react";

// Obsidian shows every aria-label as its own tooltip, which floated service names over the rows below.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/858
export const NO_OBSIDIAN_TOOLTIP = "[--no-tooltip:true]";

export interface ConnectorRowProps {
  service: ConnectorCatalogEntry;
  detail: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  highlighted?: boolean;
}

export function ConnectorRow({
  service,
  detail,
  actions,
  footer,
  highlighted,
}: ConnectorRowProps): React.ReactElement {
  return (
    <li
      aria-label={service.name}
      className={cn(
        "tw-flex tw-flex-col tw-gap-1.5 tw-rounded-md tw-border tw-border-solid tw-px-3.5 tw-py-2.5",
        NO_OBSIDIAN_TOOLTIP,
        highlighted
          ? "tw-border-interactive-accent tw-bg-primary-alt"
          : "tw-border-border tw-bg-primary"
      )}
    >
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-3 tw-gap-y-2">
        <ConnectorLogo service={service} />
        <div className="tw-min-w-0 tw-flex-1 tw-basis-24">
          <div className="tw-truncate tw-text-ui-small tw-font-semibold tw-text-normal">
            {service.name}
          </div>
          <div className="tw-text-ui-smaller tw-text-muted">{detail}</div>
        </div>
        {actions && (
          <div className="tw-ml-auto tw-flex tw-max-w-full tw-shrink-0 tw-flex-wrap tw-items-center tw-justify-end tw-gap-1">
            {actions}
          </div>
        )}
      </div>
      {footer && <div className="tw-pl-11 tw-text-ui-smaller tw-text-muted">{footer}</div>}
    </li>
  );
}

export type StatusTone = "ok" | "attention" | "idle";

interface StatusLineProps {
  tone: StatusTone;
  children: React.ReactNode;
}

export function StatusLine({ tone, children }: StatusLineProps): React.ReactElement {
  return (
    <span
      className={cn("tw-flex tw-items-start tw-gap-1.5", tone === "attention" && "tw-text-error")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "tw-mt-1.5 tw-size-1.5 tw-shrink-0 tw-rounded-full tw-bg-current",
          tone === "ok" && "tw-text-success",
          tone === "attention" && "tw-text-error",
          tone === "idle" && "tw-text-faint"
        )}
      />
      <span>{children}</span>
    </span>
  );
}

export function TextButton({ className, ...props }: ButtonProps): React.ReactElement {
  return (
    <Button
      variant="link"
      size="fit"
      className={cn(
        "clickable-icon tw-h-auto tw-border-none tw-bg-transparent tw-p-0 tw-text-ui-smaller tw-shadow-none hover:tw-bg-transparent",
        className
      )}
      {...props}
    />
  );
}

interface WaitingConnectorRowProps {
  service: ConnectorCatalogEntry;
  waitingLogin: WaitingLogin;
}

export function WaitingConnectorRow({
  service,
  waitingLogin,
}: WaitingConnectorRowProps): React.ReactElement {
  const { isCopied, copy } = useCopyToClipboard();
  const withLoginUrl = (use: (url: string) => void) => () => {
    const url = waitingLogin.loginUrl();
    if (url) use(url);
  };
  return (
    <ConnectorRow
      highlighted
      service={service}
      detail={
        <span role="status" className="tw-flex tw-items-center tw-gap-1.5 tw-text-accent">
          <Loader2 aria-hidden="true" className="tw-size-3 tw-shrink-0 tw-animate-spin" />
          Waiting for you to log in in your browser…
        </span>
      }
      actions={
        <Button size="sm" variant="secondary" onClick={() => waitingLogin.cancel()}>
          Cancel
        </Button>
      }
      footer={
        <span className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-1.5">
          Didn&apos;t see a browser window?
          <TextButton onClick={withLoginUrl(copy)}>
            <Copy aria-hidden="true" className="tw-size-3" />
            {isCopied ? "Copied" : "Copy the login link"}
          </TextButton>
          or
          <TextButton onClick={withLoginUrl((url) => window.open(url, "_blank"))}>
            open it again
          </TextButton>
        </span>
      }
    />
  );
}

interface FailedLoginStatusProps {
  service: ConnectorCatalogEntry;
  failedLogin: FailedLogin;
}

export function FailedLoginStatus({
  service,
  failedLogin,
}: FailedLoginStatusProps): React.ReactElement {
  return (
    <span className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-1.5 tw-text-error">
      <AlertCircle aria-hidden="true" className="tw-size-3 tw-shrink-0" />
      {loginFailureMessage(failedLogin.reason, service.name)}
      {failedLogin.reason === "rejected" && (
        <a href={loginRejectedIssueUrl(service)} target="_blank" rel="noopener noreferrer">
          Let us know
        </a>
      )}
    </span>
  );
}

interface LoginButtonProps extends ButtonProps {
  blockedBy: string | null;
}

export function LoginButton({ blockedBy, ...props }: LoginButtonProps): React.ReactElement {
  if (!blockedBy) return <Button size="sm" {...props} />;
  return (
    <span title={`Finish or cancel the ${blockedBy} login first`} className="tw-inline-flex">
      <Button size="sm" {...props} disabled />
    </span>
  );
}
