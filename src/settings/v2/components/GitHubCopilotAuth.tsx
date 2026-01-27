import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ChatModelProviders } from "@/constants";
import {
  GitHubCopilotProvider,
  DeviceCodeResponse,
} from "@/LLMProviders/githubCopilot/GitHubCopilotProvider";
import { useSettingsValue } from "@/settings/model";
import { ModelImporter } from "@/settings/v2/components/ModelImporter";
import { ChevronDown, ChevronUp, Loader2, Copy } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useRef, useState } from "react";

type AuthStep = "idle" | "pending" | "user" | "polling" | "done" | "error";

/**
 * GitHub Copilot OAuth authentication component.
 * Handles the device code flow and displays model importer when authenticated.
 */
export function GitHubCopilotAuth() {
  const settings = useSettingsValue();
  const [copilotProvider] = useState(() => GitHubCopilotProvider.getInstance());
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
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
      // Don't override in-flight auth UI; handleCompleteAuth() will set the final state.
      if (authStep !== "pending" && authStep !== "user" && authStep !== "polling") {
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
   * Initiates the GitHub OAuth device code flow.
   * Requests a device code and displays it to the user for authorization.
   */
  const handleStartAuth = async () => {
    const requestId = ++authRequestIdRef.current;

    setAuthStep("pending");
    setError(null);

    try {
      const deviceCodeResponse = await copilotProvider.startDeviceCodeFlow();

      // Check if request was cancelled or component unmounted
      if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
        return;
      }

      setDeviceCode(deviceCodeResponse);
      setAuthStep("user");
      setExpanded(true);
      new Notice("Please authorize in your browser, then click 'Complete'");
    } catch (e: unknown) {
      // Ignore errors if request was cancelled or component unmounted
      if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
        return;
      }

      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(errorMessage);
      setAuthStep("error");
      new Notice(`Failed to start authentication: ${errorMessage}`);
    }
  };

  /**
   * Completes the OAuth flow by polling for the access token.
   * Called after user has authorized the app in their browser.
   */
  const handleCompleteAuth = async () => {
    if (!deviceCode) {
      new Notice("Please start authentication first");
      return;
    }

    const requestId = ++authRequestIdRef.current;

    setAuthStep("polling");
    setError(null);

    try {
      await copilotProvider.pollForAccessToken(
        deviceCode.deviceCode,
        deviceCode.interval,
        deviceCode.expiresIn
      );
      await copilotProvider.fetchCopilotToken();

      // Check if request was cancelled or component unmounted
      if (!isMountedRef.current || requestId !== authRequestIdRef.current) {
        return;
      }

      setAuthStep("done");
      setDeviceCode(null);
      new Notice("GitHub Copilot connected successfully!");
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
   * Disconnects the user from GitHub Copilot.
   */
  const handleReset = () => {
    // Increment requestId to invalidate any in-flight async operations
    authRequestIdRef.current += 1;
    copilotProvider.resetAuth();
    setAuthStep("idle");
    setDeviceCode(null);
    setError(null);
    setExpanded(false);
    new Notice("GitHub Copilot disconnected");
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
  const showDeviceCode = authStep === "user" || authStep === "polling";

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
            side="right"
          >
            <span className="tw-cursor-help tw-text-warning">⚠️</span>
          </HelpTooltip>
        </div>
        <div className="tw-flex tw-flex-row tw-items-center tw-gap-2">
          <div className="tw-flex-1">
            {/* Status display */}
            <div
              className={`tw-flex tw-h-9 tw-w-full tw-items-center tw-rounded-md tw-border tw-border-border tw-px-3 tw-text-sm ${
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
          </div>
          <div>
            {isAuthenticated && (
              <Button
                onClick={handleReset}
                variant="ghost"
                className="tw-flex tw-items-center tw-justify-center tw-whitespace-nowrap tw-px-4 tw-py-2 tw-text-warning hover:tw-text-warning"
              >
                Disconnect
              </Button>
            )}
          </div>
          <div>
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
              className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-px-4 tw-py-2"
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

                <div className="tw-flex tw-items-center tw-gap-2 tw-border-t tw-pt-1 tw-border-border/50">
                  <Button
                    onClick={handleCompleteAuth}
                    disabled={authStep === "polling"}
                    variant="secondary"
                    size="sm"
                  >
                    {authStep === "polling" ? (
                      <>
                        <Loader2 className="tw-mr-1.5 tw-size-3.5 tw-animate-spin" />
                        Waiting...
                      </>
                    ) : (
                      "Complete"
                    )}
                  </Button>
                  <Button onClick={handleReset} variant="ghost" size="sm">
                    Cancel
                  </Button>
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
