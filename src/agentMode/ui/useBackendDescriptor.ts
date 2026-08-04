import {
  backendRegistry,
  getActiveBackendDescriptor,
  listBackendDescriptors,
} from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type {
  BackendAuthStatus,
  BackendDescriptor,
  BackendId,
  InstallState,
} from "@/agentMode/session/types";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React from "react";
import type CopilotPlugin from "@/main";

function installStateSignature(state: InstallState): string {
  switch (state.kind) {
    case "absent":
      return "absent";
    case "checking":
    case "ready":
      return `${state.kind}:${state.source}`;
    case "incompatible":
      return JSON.stringify([
        state.kind,
        state.source,
        state.currentVersion,
        state.minVersion,
        state.message,
      ]);
    case "error":
      return JSON.stringify([state.kind, state.message]);
  }
}

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
  const subscribe = React.useCallback(
    (listener: () => void) => manager?.subscribe(listener) ?? (() => {}),
    [manager]
  );
  const getSnapshot = React.useCallback(
    () => manager?.getStartingBackendId() ?? manager?.getActiveSession()?.backendId ?? null,
    [manager]
  );
  const sessionBackendId = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (sessionBackendId) {
    const desc = backendRegistry[sessionBackendId];
    if (desc) return desc;
  }
  return getActiveBackendDescriptor(settings);
}

/**
 * Keeps backend readiness UI synchronized with settings and asynchronous runtime checks.
 * A semantic signature is the external-store snapshot because some descriptors allocate
 * a new state object on every read even when its value has not changed.
 * @param descriptor - The backend whose readiness should be observed.
 * @param plugin - The plugin instance used to subscribe to backend-specific readiness changes.
 */
export function useBackendInstallState(
  descriptor: BackendDescriptor,
  plugin: CopilotPlugin
): InstallState {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => descriptor.subscribeInstallState(plugin, listener),
    [descriptor, plugin]
  );
  const getSnapshot = React.useCallback(
    () => installStateSignature(descriptor.getInstallState(settings)),
    [descriptor, settings]
  );
  const signature = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void signature;
    return descriptor.getInstallState(settings);
  }, [descriptor, settings, signature]);
}

/**
 * Same contract as `useBackendInstallState`, widened to every registered
 * backend at once, for surfaces that list all agents side by side. One store
 * subscription fans out to every descriptor and the snapshot is the joined
 * signature, so a descriptor that allocates a fresh state object per read still
 * cannot force a rerender — and the returned record keeps its identity until a
 * backend's readiness actually changes.
 * @param plugin - The plugin instance used to subscribe to backend-specific readiness changes.
 */
export function useBackendInstallStates(plugin: CopilotPlugin): Record<BackendId, InstallState> {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const unsubscribes = listBackendDescriptors().map((descriptor) =>
        descriptor.subscribeInstallState(plugin, listener)
      );
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    [plugin]
  );
  const getSnapshot = React.useCallback(
    () =>
      listBackendDescriptors()
        .map(
          (descriptor) =>
            `${descriptor.id}=${installStateSignature(descriptor.getInstallState(settings))}`
        )
        .join("|"),
    [settings]
  );
  const signature = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void signature;
    const states = {} as Record<BackendId, InstallState>;
    for (const descriptor of listBackendDescriptors()) {
      states[descriptor.id] = descriptor.getInstallState(settings);
    }
    return states;
  }, [settings, signature]);
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
