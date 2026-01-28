import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ChatModelProviders } from "@/constants";
import {
  GitHubCopilotProvider,
  DeviceCodeResponse,
} from "@/LLMProviders/githubCopilot/GitHubCopilotProvider";
import { isAuthCancelledError } from "@/LLMProviders/githubCopilot/errors";
import { useSettingsValue } from "@/settings/model";
import { ModelImporter } from "@/settings/v2/components/ModelImporter";
import { ChevronDown, ChevronUp, Loader2, Copy } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useRef, useState } from "react";

type AuthStep = "idle" | "pending" | "polling" | "done" | "error";

/**
 * GitHub Copilot OAuth authentication component.
 * Handles the device code flow and displays model importer when authenticated.
 */
export function GitHubCopilotAuth() {
  const settings = useSettingsValue();
  const [copilotProvider] = useState(() => GitHubCopilotProvider.getInstance());
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const authRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  // Cleanup on unmount: abort polling and prevent setState
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      authRequestIdRef.current += 1;
      copilotProvider.abortPolling();
    };
  }, [copilotProvider]);

  // Check initial auth state
  useEffect(() => {
    const state = copilotProvider.getAuthState();
    if (state.status === "authenticated") {
      setAuthStep("done");
    }
  }, [copilotProvider]);

  // Update auth step when settings change - reuse getAuthState() for consistency
  useEffect(() => {
    const state = copilotProvider.getAuthState();
    if (state.status === "authenticated") {
      // Don't override in-flight auth UI during polling
      if (authStep !== "pending" && authStep !== "polling") {
        setAuthStep("done");
      }
    } else if (authStep === "done") {
      // Token expired or cleared, reset to idle
      setAuthStep("idle");
    }
  }, [
    settings.githubCopilotToken,
    settings.githubCopilotAccessToken,
    settings.githubCopilotTokenExpiresAt,
    copilotProvider,
    authStep,
  ]);

  /**
   * Runs the polling flow to complete OAuth authorization.
   * Shared by handleStartAuth (after getting device code) and handleRetryPolling.
   * @param code - The device code response containing deviceCode, interval, expiresIn
   * @param requestId - The request ID to check for cancellation
   */
  const runPollingFlow = async (code: DeviceCodeResponse, requestId: number) => {
    await copilotProvider.pollForAccessToken(
      code.deviceCode,
      code.interval,
      code.expiresIn,
      (attempt) => {
        if (isMountedRef.current && requestId === authRequestIdRef.current) {
          setPollCount(attempt);
        }
      }
    );

    await copilotProvider.fetchCopilotToken();

    if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
      return;
    }

    setAuthStep("done");
    setDeviceCode(null);
    new Notice("GitHub Copilot connected successfully!");
  };

  /**
   * Initiates the GitHub OAuth device code flow.
   * Requests a device code and automatically starts polling for authorization.
   */
  const handleStartAuth = async () => {
    const requestId = ++authRequestIdRef.current;

    setAuthStep("pending");
    setError(null);
    setPollCount(0);

    try {
      const deviceCodeResponse = await copilotProvider.startDeviceCodeFlow();

      // Check if request was cancelled or component unmounted
      if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
        return;
      }

      setDeviceCode(deviceCodeResponse);
      setAuthStep("polling");
      setExpanded(true);

      // Automatically start polling for authorization
      try {
        await runPollingFlow(deviceCodeResponse, requestId);
      } catch (pollError: unknown) {
        // Ignore if cancelled or component unmounted
        if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
          return;
        }
        // If cancelled by user (e.g., handleReset called), don't show error
        if (isAuthCancelledError(pollError)) {
          return;
        }
        throw pollError;
      }
    } catch (e: unknown) {
      // Ignore errors if request was cancelled or component unmounted
      if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
        return;
      }

      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
      setAuthStep("error");
      new Notice(`Authentication failed: ${errorMessage}`);
    }
  };

  /**
   * Resets the authentication state and clears all stored tokens.
   * Disconnects the user from GitHub Copilot or cancels in-progress authentication.
   */
  const handleReset = () => {
    // Check if we're in an auth flow: actively authenticating OR error state with device code
    const isInAuthFlow =
      authStep === "pending" || authStep === "polling" || (authStep === "error" && deviceCode);
    // Increment requestId to invalidate any in-flight async operations
    authRequestIdRef.current += 1;
    copilotProvider.resetAuth();
    setAuthStep("idle");
    setDeviceCode(null);
    setError(null);
    setPollCount(0);
    setExpanded(false);
    new Notice(isInAuthFlow ? "Authentication cancelled" : "GitHub Copilot disconnected");
  };

  /**
   * Copies the given text to the clipboard and shows a notification.
   * @param text - The text to copy to clipboard
   */
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      new Notice("Copied to clipboard!");
    } catch {
      new Notice("Failed to copy to clipboard");
    }
  };

  const isAuthenticated = authStep === "done";
  const isAuthenticating = authStep === "pending" || authStep === "polling";
  // Show device code during polling or error (if device code still exists and hasn't expired)
  const showDeviceCode = (authStep === "polling" || authStep === "error") && deviceCode !== null;

  /**
   * Retries polling with the existing device code.
   * Used when polling fails due to network errors but device code is still valid.
   */
  const handleRetryPolling = async () => {
    if (!deviceCode) return;

    const requestId = ++authRequestIdRef.current;
    setAuthStep("polling");
    setError(null);
    setPollCount(0);

    try {
      await runPollingFlow(deviceCode, requestId);
    } catch (e: unknown) {
      if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
        return;
      }
      // If cancelled by user (e.g., handleReset called), don't show error
      if (isAuthCancelledError(e)) {
        return;
      }

      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
      setAuthStep("error");
      new Notice(`Authentication failed: ${errorMessage}`);
    }
  };

  return (
    <>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1 tw-font-medium">
          <div className="tw-truncate">GitHub Copilot</div>
          <HelpTooltip
            content={
              <div className="tw-max-w-[250px]">
                <div className="tw-font-semibold">Unofficial Integration</div>
                <p className="tw-mt-1">
                  This uses GitHub Copilot&apos;s internal API, which is not officially supported
                  for third-party apps. It may stop working at any time.
                </p>
              </div>
            }
            side="bottom"
          >
            <span className="tw-cursor-help tw-text-warning">⚠️</span>
          </HelpTooltip>
        </div>
        <div className="tw-flex tw-flex-col tw-gap-2 sm:tw-flex-row sm:tw-items-center">
          {/* Status display */}
          <div
            className={`tw-flex tw-h-9 tw-flex-1 tw-items-center tw-rounded-md tw-border tw-border-border tw-px-3 tw-text-sm ${
              isAuthenticated
                ? "tw-text-success"
                : isAuthenticating
                  ? "tw-text-warning"
                  : authStep === "error"
                    ? "tw-text-error"
                    : "tw-text-muted"
            }`}
          >
            {isAuthenticated
              ? "✓ Connected"
              : isAuthenticating
                ? "Authenticating..."
                : authStep === "error"
                  ? "Error - Click Setup to retry"
                  : "Not connected"}
          </div>
          {/* Action buttons */}
          <div className="tw-flex tw-items-center tw-gap-2">
            {isAuthenticated && (
              <Button
                onClick={handleReset}
                variant="ghost"
                className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-whitespace-nowrap tw-px-4 tw-py-2 tw-text-warning hover:tw-text-warning sm:tw-flex-none"
              >
                Disconnect
              </Button>
            )}
            <Button
              onClick={() => {
                if (!isAuthenticated && !isAuthenticating) {
                  handleStartAuth();
                } else {
                  setExpanded(!expanded);
                }
              }}
              disabled={isAuthenticating}
              variant="secondary"
              className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-px-4 tw-py-2 sm:tw-flex-none"
            >
              {isAuthenticating ? (
                <Loader2 className="tw-size-4 tw-animate-spin" />
              ) : isAuthenticated ? (
                <>
                  Add Model
                  {expanded ? (
                    <ChevronUp className="tw-ml-1 tw-size-4" />
                  ) : (
                    <ChevronDown className="tw-ml-1 tw-size-4" />
                  )}
                </>
              ) : (
                "Setup"
              )}
            </Button>
          </div>
        </div>
        <div>
          <a
            href="https://github.com/settings/apps/authorizations"
            target="_blank"
            rel="noopener noreferrer"
            className="tw-text-[10px] tw-text-accent hover:tw-text-accent-hover sm:tw-text-xs"
          >
            Manage GitHub Authorizations
          </a>
        </div>
      </div>

      <Collapsible open={expanded}>
        <CollapsibleContent className="tw-rounded-md tw-p-3">
          <div className="tw-flex tw-flex-col tw-gap-2">
            {/* Device code flow UI */}
            {showDeviceCode && deviceCode && (
              <div className="tw-space-y-2.5 tw-rounded-lg tw-border tw-border-border tw-p-3.5 tw-bg-muted/10">
                <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs">
                  <span className="tw-font-semibold">1.</span>
                  <span className="tw-text-muted">Go to:</span>
                  <a
                    href={deviceCode.verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tw-break-all tw-text-accent tw-underline hover:tw-text-accent-hover"
                  >
                    {deviceCode.verificationUri}
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(deviceCode.verificationUri)}
                    className="tw-size-5 tw-shrink-0 tw-p-0"
                    title="Copy URL"
                  >
                    <Copy className="tw-size-3.5" />
                  </Button>
                </div>

                <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs">
                  <span className="tw-font-semibold">2.</span>
                  <span className="tw-text-muted">Enter code:</span>
                  <code className="tw-rounded-md tw-border-border tw-px-3 tw-py-1.5 tw-font-mono tw-text-base tw-font-bold tw-tracking-widest tw-bg-accent/10 tw-border-accent/30">
                    {deviceCode.userCode}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(deviceCode.userCode)}
                    className="tw-size-5 tw-shrink-0 tw-p-0"
                    title="Copy code"
                  >
                    <Copy className="tw-size-3.5" />
                  </Button>
                </div>

                <div className="tw-flex tw-flex-col tw-gap-2 tw-border-t tw-pt-2 tw-border-border/50">
                  {authStep === "polling" ? (
                    <>
                      <div className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-py-1 tw-text-xs tw-text-muted">
                        <Loader2 className="tw-size-3.5 tw-animate-spin" />
                        <span>
                          Waiting for authorization...{pollCount > 0 && ` (Attempt ${pollCount})`}
                        </span>
                      </div>
                      <Button onClick={handleReset} variant="ghost" size="sm" className="tw-w-full">
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-py-1 tw-text-xs tw-text-error">
                        <span>Polling failed - you can retry with the same code</span>
                      </div>
                      <div className="tw-flex tw-gap-2">
                        <Button
                          onClick={handleRetryPolling}
                          variant="secondary"
                          size="sm"
                          className="tw-flex-1"
                        >
                          Retry
                        </Button>
                        <Button
                          onClick={handleReset}
                          variant="ghost"
                          size="sm"
                          className="tw-flex-1"
                        >
                          Start Over
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Model selection - reuse ModelImporter */}
            {isAuthenticated && (
              <ModelImporter
                provider={ChatModelProviders.GITHUB_COPILOT}
                isReady={isAuthenticated}
                expanded={expanded}
                credentialVersion={settings.githubCopilotToken}
              />
            )}

            {/* Error message */}
            {error && (
              <div className="tw-rounded-lg tw-border tw-border-border tw-p-3.5 tw-text-xs tw-text-error tw-bg-muted/10">
                {error}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
