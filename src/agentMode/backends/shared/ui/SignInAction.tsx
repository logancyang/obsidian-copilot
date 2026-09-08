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
  signInLabel?: string;
}

/** Browser sign-in controls shared by Claude and Codex, including recoverable browser-launch failure.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/379
 */
export const SignInAction: React.FC<SignInActionProps> = (auth) => (
  <div className="tw-flex tw-flex-col tw-items-start tw-gap-2" aria-live="polite">
    {auth.status?.signedIn ? (
      <span>Signed in{auth.status.label ? ` as ${auth.status.label}` : ""}.</span>
    ) : (
      <>
        {auth.signingIn && (
          <p className="tw-my-0 tw-text-sm tw-text-muted">Finish signing in in your browser.</p>
        )}
        {auth.failed && (
          <p className="tw-my-0 tw-text-sm tw-text-muted">Sign-in didn't complete. Try again.</p>
        )}
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          {auth.signingIn && auth.url ? (
            <Button asChild variant="default" size="sm">
              <a href={auth.url} target="_blank" rel="noopener noreferrer">
                Open sign-in page
              </a>
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={auth.onSignIn}
              disabled={auth.signingIn || auth.status === null}
            >
              {auth.signingIn
                ? "Signing in…"
                : auth.failed
                  ? "Try again"
                  : auth.status === null
                    ? "Checking sign-in…"
                    : (auth.signInLabel ?? "Sign in")}
            </Button>
          )}
          {auth.signingIn && auth.onCancel && (
            <Button variant="ghost" size="sm" onClick={auth.onCancel}>
              Cancel sign-in
            </Button>
          )}
        </div>
      </>
    )}
  </div>
);
