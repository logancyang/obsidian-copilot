import type { BackendAuthStatus } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import React from "react";

export interface SignInActionProps {
  status: BackendAuthStatus | null;
  onSignIn: () => void;
  signingIn: boolean;
  url: string | null;
  onCancel?: () => void;
  failed?: boolean;
}

/** Browser sign-in controls shared by Claude and Codex, including recoverable browser-launch failure.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/379
 */
export const SignInAction: React.FC<SignInActionProps> = (auth) => (
  <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2" aria-live="polite">
    {auth.status?.signedIn ? (
      <span>Signed in{auth.status.label ? ` as ${auth.status.label}` : ""}.</span>
    ) : (
      <>
        {auth.signingIn && auth.url ? (
          <Button asChild variant="secondary" size="sm">
            <a href={auth.url} target="_blank" rel="noopener noreferrer">
              Open sign-in page
            </a>
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={auth.onSignIn}
            disabled={auth.signingIn || auth.status === null}
          >
            {auth.signingIn
              ? "Signing in…"
              : auth.failed
                ? "Retry"
                : auth.status === null
                  ? "Checking sign-in…"
                  : "Sign in"}
          </Button>
        )}
        {auth.signingIn && auth.onCancel && (
          <Button variant="ghost" size="sm" onClick={auth.onCancel}>
            Cancel sign-in
          </Button>
        )}
        {auth.failed && <span>Sign-in didn't complete. Please try again.</span>}
      </>
    )}
  </div>
);
