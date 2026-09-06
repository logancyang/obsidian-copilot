import type { BackendAuth, BackendAuthStatus, BackendDescriptor } from "@/agentMode/session/types";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React from "react";

interface BackendAuthSnapshot {
  readonly status: BackendAuthStatus | null;
  readonly signingIn: boolean;
  readonly url: string | null;
  readonly failed: boolean;
}

const EMPTY_AUTH_SNAPSHOT = Object.freeze<BackendAuthSnapshot>({
  status: null,
  signingIn: false,
  url: null,
  failed: false,
});
const authSnapshots = new WeakMap<BackendAuth, BackendAuthSnapshot>();
const authSubscribers = new WeakMap<BackendAuth, Set<() => void>>();
const authControllers = new WeakMap<BackendAuth, AbortController>();
const authProbeGenerations = new WeakMap<BackendAuth, number>();

const getAuthSnapshot = (auth: BackendAuth): BackendAuthSnapshot =>
  authSnapshots.get(auth) ?? EMPTY_AUTH_SNAPSHOT;

const subscribeAuthState = (auth: BackendAuth, subscriber: () => void): (() => void) => {
  const subscribers = authSubscribers.get(auth) ?? new Set<() => void>();
  subscribers.add(subscriber);
  authSubscribers.set(auth, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) authSubscribers.delete(auth);
  };
};

const updateAuthSnapshot = (auth: BackendAuth, update: Partial<BackendAuthSnapshot>): void => {
  const current = getAuthSnapshot(auth);
  const next = Object.freeze({ ...current, ...update });
  if (
    current.status === next.status &&
    current.signingIn === next.signingIn &&
    current.url === next.url &&
    current.failed === next.failed
  ) {
    return;
  }
  authSnapshots.set(auth, next);
  authSubscribers.get(auth)?.forEach((subscriber) => subscriber());
};

const beginAuthProbe = (auth: BackendAuth): number => {
  const generation = (authProbeGenerations.get(auth) ?? 0) + 1;
  authProbeGenerations.set(auth, generation);
  return generation;
};

const publishAuthProbeStatus = (
  auth: BackendAuth,
  status: BackendAuthStatus,
  generation: number
): void => {
  if (authProbeGenerations.get(auth) !== generation || getAuthSnapshot(auth).signingIn) return;
  updateAuthSnapshot(auth, { status });
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
  cancelSignIn: () => void;
  failed: boolean;
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

  const loginController = React.useRef<AbortController | null>(null);
  const auth = descriptor.auth;
  const cancelSignIn = React.useCallback(() => {
    if (auth) authControllers.get(auth)?.abort();
  }, [auth]);
  React.useEffect(() => () => loginController.current?.abort(), []);
  const previousProbeKey = React.useRef(probeKey);
  const subscribe = React.useCallback(
    (subscriber: () => void) => (auth ? subscribeAuthState(auth, subscriber) : () => undefined),
    [auth]
  );
  const getSnapshot = React.useCallback(
    () => (auth ? getAuthSnapshot(auth) : EMPTY_AUTH_SNAPSHOT),
    [auth]
  );
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  React.useEffect(() => {
    if (!auth) return;
    if (previousProbeKey.current !== probeKey) {
      previousProbeKey.current = probeKey;
      authControllers.get(auth)?.abort();
      updateAuthSnapshot(auth, { signingIn: false, url: null });
    }
    if (getAuthSnapshot(auth).signingIn) return;
    const generation = beginAuthProbe(auth);
    updateAuthSnapshot(auth, { status: null });
    void auth.getStatus(settingsRef.current).then(
      (s) => publishAuthProbeStatus(auth, s, generation),
      (e) => {
        logError("[AgentMode] auth status probe failed", e);
        publishAuthProbeStatus(auth, { signedIn: false }, generation);
      }
    );
  }, [auth, probeKey]);

  const signIn = React.useCallback(() => {
    if (!auth || getAuthSnapshot(auth).signingIn) return;
    const generation = beginAuthProbe(auth);
    const controller = new AbortController();
    loginController.current = controller;
    authControllers.set(auth, controller);
    updateAuthSnapshot(auth, { signingIn: true, url: null, failed: false });
    new Notice(`Opening your browser to sign in to ${descriptor.displayName}…`);
    auth
      .signIn(settingsRef.current, {
        signal: controller.signal,
        onUrl: (url) => {
          if (!controller.signal.aborted && getAuthSnapshot(auth).signingIn)
            updateAuthSnapshot(auth, { url });
        },
      })
      .then((s) => {
        // Cancelled or replaced probes must not publish credentials for an old profile.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
        if (controller.signal.aborted || authProbeGenerations.get(auth) !== generation) return;
        updateAuthSnapshot(auth, { status: s, failed: !s.signedIn });
        new Notice(
          s.signedIn
            ? `Signed in to ${descriptor.displayName}${s.label ? ` as ${s.label}` : ""}.`
            : `Sign-in didn't complete. Please try again.`
        );
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        updateAuthSnapshot(auth, { failed: true });
        logError("[AgentMode] sign-in failed", e);
        new Notice(`Sign-in to ${descriptor.displayName} failed. Please try again.`);
      })
      .finally(() => {
        if (authProbeGenerations.get(auth) === generation)
          updateAuthSnapshot(auth, { signingIn: false, url: null });
      });
  }, [auth, descriptor.displayName]);

  return { ...snapshot, signIn, cancelSignIn };
}
