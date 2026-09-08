import { ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { SignInAction, type SignInActionProps } from "@/agentMode/backends/shared/ui/SignInAction";
import { CommandBlock } from "@/agentMode/backends/shared/ui/SetupSteps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import React from "react";

export interface AuthenticationState extends SignInActionProps {
  onSignOut: () => void;
  signingOut: boolean;
  terminalCommand: string | null;
}

interface AuthenticationSectionProps {
  ready: boolean;
  unavailableMessage: string;
  auth: AuthenticationState;
}

/** Account controls for CLI-backed agents; the container owns commands and authentication effects. */
export const AuthenticationSection: React.FC<AuthenticationSectionProps> = ({
  ready,
  unavailableMessage,
  auth,
}) => (
  <ConfigSection
    title="Authentication"
    badge={
      ready && (
        <Badge variant={auth.status?.signedIn ? "success" : "outline"} role="status">
          {auth.status === null
            ? "Checking…"
            : auth.status.signedIn
              ? "Signed in"
              : "Not signed in"}
        </Badge>
      )
    }
  >
    {/* An unavailable CLI cannot authenticate; terminal instructions apply only to a confirmed signed-out profile.
        https://github.com/Brevilabs/obsidian-copilot-private/issues/379 */}
    {!ready ? (
      <div
        role="alert"
        className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-bg-callout-warning/20 tw-p-3 tw-text-sm tw-border-warning/40"
      >
        <AlertTriangle aria-hidden className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning" />
        <p className="tw-my-0">{unavailableMessage}</p>
      </div>
    ) : auth.status?.signedIn ? (
      <div className="tw-flex tw-flex-col tw-items-start tw-gap-2">
        <div className="tw-flex tw-w-full tw-flex-wrap tw-items-center tw-gap-3">
          {auth.status.label && (
            <p className="tw-my-0 tw-min-w-0 tw-break-words tw-text-sm tw-text-muted">
              Signed in as {auth.status.label}.
            </p>
          )}
          <Button variant="secondary" onClick={auth.onSignOut} disabled={auth.signingOut}>
            {auth.signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
        {auth.failed && (
          <p className="tw-my-0 tw-text-sm tw-text-error">Sign-out didn't complete. Try again.</p>
        )}
      </div>
    ) : (
      <>
        <SignInAction {...auth} signInLabel="Sign in with your browser" />
        {auth.status?.signedIn === false && auth.terminalCommand && (
          <div className="tw-mt-2 tw-flex tw-flex-col tw-gap-2">
            <p className="tw-my-0 tw-text-sm tw-font-medium">Sign in using a terminal instead</p>
            <CommandBlock command={auth.terminalCommand} />
          </div>
        )}
      </>
    )}
  </ConfigSection>
);
