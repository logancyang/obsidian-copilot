import { backendRegistry, getActiveBackendDescriptor } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendAuthStatus, BackendDescriptor, InstallState } from "@/agentMode/session/types";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React from "react";

/** Resolve the active (default) backend descriptor from settings. */
export function useActiveBackendDescriptor(): BackendDescriptor {
  return getActiveBackendDescriptor(useSettingsValue());
}

/**
 * Resolve the descriptor for the currently active *session*'s backend.
 * Falls back to the default backend descriptor when there is no active
 * session (e.g. the no-session fallback view, or before auto-spawn lands).
 *
 * Status pills, install CTAs, and other session-scoped UI should prefer
 * this over `useActiveBackendDescriptor` so the displayed display name /
 * version / install handler matches the running session — which can be on
 * a non-default backend after a cross-backend model pick + new tab.
 */
export function useSessionBackendDescriptor(
  manager: AgentSessionManager | null | undefined
): BackendDescriptor {
  const settings = useSettingsValue();
  const [, forceRender] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => forceRender((n) => n + 1));
  }, [manager]);
  const sessionBackendId =
    manager?.getStartingBackendId() ?? manager?.getActiveSession()?.backendId;
  if (sessionBackendId) {
    const desc = backendRegistry[sessionBackendId];
    if (desc) return desc;
  }
  return getActiveBackendDescriptor(settings);
}

/** Compute the descriptor's current install state. Recomputes each render. */
export function useBackendInstallState(descriptor: BackendDescriptor): InstallState {
  return descriptor.getInstallState(useSettingsValue());
}

export interface BackendAuthUiState {
  /**
   * Latest sign-in state, or `null` while the initial probe is in flight or
   * when the backend has no `auth` capability. Consumers should render the
   * Sign-in CTA only when `status?.signedIn === false`.
   */
  status: BackendAuthStatus | null;
  /** True while an interactive sign-in is running. */
  signingIn: boolean;
  /** OAuth fallback URL to surface as a clickable link while signing in. */
  url: string | null;
  /** Start the interactive sign-in flow (no-op if already running). */
  signIn: () => void;
}

/**
 * Probe and drive a backend's sign-in state for the status pill. Checks once on
 * mount (proactive — a signed-out backend shows the CTA before the user types)
 * and again after a sign-in completes; reports start/result via `Notice`.
 * Backends without an `auth` capability always report `status: null`.
 */
export function useBackendAuthState(descriptor: BackendDescriptor): BackendAuthUiState {
  const settings = useSettingsValue();
  // Latest settings without making the mount probe re-fire on unrelated edits.
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;

  const auth = descriptor.auth;
  const [status, setStatus] = React.useState<BackendAuthStatus | null>(null);
  const [signingIn, setSigningIn] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!auth) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    void auth.getStatus(settingsRef.current).then(
      (s) => !cancelled && setStatus(s),
      (e) => {
        logError("[AgentMode] auth status probe failed", e);
        if (!cancelled) setStatus({ signedIn: false });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const signIn = React.useCallback(() => {
    if (!auth || signingIn) return;
    setSigningIn(true);
    setUrl(null);
    new Notice(`Opening your browser to sign in to ${descriptor.displayName}…`);
    auth
      .signIn(settingsRef.current, { onUrl: (u) => setUrl(u) })
      .then((s) => {
        setStatus(s);
        new Notice(
          s.signedIn
            ? `Signed in to ${descriptor.displayName}${s.label ? ` as ${s.label}` : ""}.`
            : `Sign-in didn't complete. Please try again.`
        );
      })
      .catch((e) => {
        logError("[AgentMode] sign-in failed", e);
        new Notice(`Sign-in to ${descriptor.displayName} failed. Please try again.`);
      })
      .finally(() => {
        setSigningIn(false);
        setUrl(null);
      });
  }, [auth, signingIn, descriptor.displayName]);

  return { status, signingIn, url, signIn };
}
