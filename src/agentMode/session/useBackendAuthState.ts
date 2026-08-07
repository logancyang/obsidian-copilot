import type { BackendAuth, BackendAuthStatus, BackendDescriptor } from "@/agentMode/session/types";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React from "react";

type AuthStatusSubscriber = (status: BackendAuthStatus) => void;

const authStatusSubscribers = new WeakMap<BackendAuth, Set<AuthStatusSubscriber>>();
const authStatusGenerations = new WeakMap<BackendAuth, number>();

const subscribeAuthStatus = (auth: BackendAuth, subscriber: AuthStatusSubscriber): (() => void) => {
  const subscribers = authStatusSubscribers.get(auth) ?? new Set<AuthStatusSubscriber>();
  subscribers.add(subscriber);
  authStatusSubscribers.set(auth, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) authStatusSubscribers.delete(auth);
  };
};

const beginAuthStatusOperation = (auth: BackendAuth): number => {
  const generation = (authStatusGenerations.get(auth) ?? 0) + 1;
  authStatusGenerations.set(auth, generation);
  return generation;
};

const publishAuthStatus = (
  auth: BackendAuth,
  status: BackendAuthStatus,
  generation: number
): void => {
  if (authStatusGenerations.get(auth) !== generation) return;
  authStatusSubscribers.get(auth)?.forEach((subscriber) => subscriber(status));
};

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
 * Probe and drive a backend's sign-in state. Checks once on mount (proactive —
 * a signed-out backend shows the CTA before the user types) and again after a
 * sign-in completes; reports start/result via `Notice`. Backends without an
 * `auth` capability always report `status: null`.
 *
 * Lives in `session/` because it is written purely against the
 * `descriptor.auth` contract and is consumed from both `ui/` surfaces and
 * backend-owned Configure dialogs — the contract layer is the only home both
 * may import.
 *
 * @param descriptor - Backend whose authentication capability should be observed and driven.
 * @param probeKey - Caller-owned identity for auth-relevant inputs that should trigger a fresh probe.
 */
export function useBackendAuthState(
  descriptor: BackendDescriptor,
  probeKey?: unknown
): BackendAuthUiState {
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
    const unsubscribe = subscribeAuthStatus(auth, setStatus);
    const generation = beginAuthStatusOperation(auth);
    void auth.getStatus(settingsRef.current).then(
      (s) => publishAuthStatus(auth, s, generation),
      (e) => {
        logError("[AgentMode] auth status probe failed", e);
        publishAuthStatus(auth, { signedIn: false }, generation);
      }
    );
    return unsubscribe;
  }, [auth, probeKey]);

  const signIn = React.useCallback(() => {
    if (!auth || signingIn) return;
    const generation = beginAuthStatusOperation(auth);
    setSigningIn(true);
    setUrl(null);
    new Notice(`Opening your browser to sign in to ${descriptor.displayName}…`);
    auth
      .signIn(settingsRef.current, { onUrl: (u) => setUrl(u) })
      .then((s) => {
        publishAuthStatus(auth, s, generation);
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
