import { Input } from "@/components/ui/input";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { SettingItem } from "@/components/ui/setting-item";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingSection } from "@/components/ui/setting-section";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { createMiyoPageUrl } from "@/lib/miyoLinks";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { MiyoServiceDiscovery } from "@/miyo/MiyoServiceDiscovery";
import { type CapabilityStatus, refreshMiyoStatus } from "@/miyo/miyoStatusStore";
import {
  getMiyoCustomUrl,
  getMiyoFolderName,
  isLocalMiyoUrl,
  MIYO_CHATS_DEEPLINK_URL,
  MIYO_CONNECT_DEEPLINK_URL,
} from "@/miyo/miyoUtils";
import { getMiyoConnectionMode } from "@/miyo/miyoRuntimePolicy";
import { useMiyoStatus } from "@/miyo/useMiyoStatus";
import { notifyMiyoIndexChanged } from "@/miyo/miyoIndex";
import { extractAppIgnoreSettings, getSystemExcludedFolders } from "@/search/searchUtils";
import { getSettings, setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import {
  type ConnectOutcome,
  type ConnectStep,
  MiyoConnectModal,
} from "@/settings/v2/components/MiyoConnectModal";
import { MiyoStatusRow } from "@/settings/v2/components/MiyoStatusRow";
import {
  MiyoAvailabilityNotice,
  MiyoConnectionControl,
} from "@/settings/v2/components/ui/MiyoConnectionControl";
import { err2String } from "@/utils";
import { getVaultBase } from "@/utils/vaultPath";
import { ArrowUpRight, CornerDownRight } from "lucide-react";
import { Notice, Platform } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";

/** Accent-tinted "Relay" chip shown next to the Connector (the paid relay plan). */
const RelayTag: React.FC = () => (
  <span className="tw-rounded tw-px-1.5 tw-py-0.5 tw-text-smallest tw-font-semibold tw-uppercase tw-tracking-wide tw-text-accent tw-bg-interactive-accent/20">
    Relay
  </span>
);

/** Status sub-line for the Connector row, derived from relay reachability. */
function connectorStatusText(status: CapabilityStatus): string {
  switch (status) {
    case "available":
      return "Connected — tunnel & sign-in active";
    case "unavailable":
      return "Not set up — finish tunnel & sign-in in Miyo";
    default:
      // unknown / stale: no live relay signal yet.
      return "Checking…";
  }
}

/** Status sub-line for the Search chat row, derived from chat-sync reachability. */
function chatSyncStatusText(status: CapabilityStatus): string {
  switch (status) {
    case "available":
      return "Ready · chats indexed";
    case "syncing":
      return "Syncing chats…";
    case "unavailable":
      return "Not set up — add chat sources in Miyo";
    default:
      // unknown / stale: no live chat-sync signal yet.
      return "Checking…";
  }
}

/**
 * A capability row: title (with optional trailing tag) + description on the left,
 * an arbitrary control on the right. Mirrors SettingItem's row geometry so the
 * Miyo capabilities line up with the real setting rows around them. Horizontal
 * padding comes from the enclosing SettingSection (`[&>*]:tw-px-4`), so rows only
 * carry vertical padding here.
 */
interface CapabilityRowProps {
  title: React.ReactNode;
  description: React.ReactNode;
  control: React.ReactNode;
  indented?: boolean;
}

const CapabilityRow: React.FC<CapabilityRowProps> = ({
  title,
  description,
  control,
  indented = false,
}) => (
  <div
    className={cn(
      "tw-flex tw-flex-col tw-items-start tw-justify-between tw-gap-4 tw-py-4 sm:tw-flex-row sm:tw-items-center",
      // `!` so the indent beats the parent's `[&>*]:tw-px-4` (equal specificity,
      // and px-4 is emitted later, which would otherwise cancel a plain pl-*).
      indented && "!tw-pl-9"
    )}
  >
    <div className="tw-w-full tw-space-y-1.5 sm:tw-w-[300px]">
      <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-medium tw-leading-none">
        {title}
      </div>
      <div className="tw-text-xs tw-text-muted">{description}</div>
    </div>
    <div className="tw-flex tw-w-full tw-flex-1 tw-items-center tw-gap-2 sm:tw-justify-end">
      {control}
    </div>
  </div>
);

/**
 * Miyo tab. Connection state comes from the Miyo status store (single-flight +
 * TTL + referentially stable snapshot); the "Powered by Miyo" capability block
 * gates on `backend === "available"`, and the Connector / Search chat rows read
 * their live per-capability status. The store is on-demand: we refresh on mount,
 * on URL commit, and on Connect — never on a poll.
 */
export const MiyoSettings: React.FC = () => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const status = useMiyoStatus();

  // An incomplete address is a draft, never an active local-discovery fallback.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draft, setDraft] = useState<{
    mode: "local" | "remote";
    address: string;
    source: string;
  } | null>(null);
  const activeMode = getMiyoConnectionMode(settings);
  const activeUrl = getMiyoCustomUrl(settings);
  const settingsKey = `${activeMode}:${settings.miyoServerUrl}`;
  const currentDraft = draft?.source === settingsKey ? draft : null;
  const mode = currentDraft?.mode ?? activeMode;
  const urlDraft = currentDraft?.address ?? activeUrl;
  const [connectionError, setConnectionError] = useState<{
    endpoint: string;
    message: string;
  } | null>(null);
  const [vaultResult, setVaultResult] = useState<{ endpoint: string; message: string } | null>(
    null
  );
  // An enabled backend with no prior snapshot is about to run the mount check.
  // Start in checking so the first paint cannot flash a false Unavailable state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/356
  const [refreshing, setRefreshing] = useState(
    settings.enableMiyo && (status.backend === "unknown" || status.backend === "stale")
  );
  // Reason: avoid setState after unmount when an in-flight refresh resolves late.
  const mountedRef = useRef(true);
  // Reason: the Connect flow is an Obsidian Modal (imperative), so hold the open
  // instance to close it if this tab unmounts before the user dismisses it.
  const connectModalRef = useRef<MiyoConnectModal | null>(null);
  // Reason: connection is multi-step async (probe → registration check → enable).
  // Each attempt bumps this token and captures its value; a later stage only
  // applies its effect (settings write / step change) while still the current
  // attempt. A new attempt or unmount supersedes in-flight ones — so a slow older
  // probe can't overwrite a newer result, and a cancelled/unmounted attempt never
  // writes enableMiyo.
  const connectAttemptRef = useRef(0);
  // Owns the optimistic enable-write transaction. `enableMiyoBackend` writes the
  // flags true BEFORE awaiting the health check, so with concurrent Connect/Retry
  // presses (which share the store's single-flight refresh) an OLDER call could
  // resolve last and roll its writes back over a NEWER call that already committed
  // `true`. Each enable captures a fresh token; a call only reverts while it's
  // still the current owner, so a superseding enable's write is never clobbered.
  const enableTxnRef = useRef(0);
  // Reason: the search-skill install/remove is async disk I/O. Each flip bumps
  // this token; only a newer flip supersedes an older one and skips its persist.
  // Unmount does NOT bump the token — an in-flight op still reconciles its
  // completed disk result to the flag, and only its Notice/UI updates are
  // suppressed. Independent of the connect guard (path A vs path B).
  const skillAttemptRef = useRef(0);
  // Reason: while an install/remove is in flight, reflect the user's requested
  // state optimistically on the switch, but only COMMIT the flag once the disk
  // op confirms — so a collision/failure leaves the persisted flag untouched.
  const [pendingSkillEnabled, setPendingSkillEnabled] = useState<boolean | null>(null);
  // Reason: `refreshing` must reflect "any probe/refresh in flight". With
  // concurrent attempts a per-call boolean flips false as soon as the *first*
  // finishes, re-enabling Connect while another is still running — so we
  // reference-count instead and only clear when the last one settles.
  const inFlightRef = useRef(0);

  const beginBusy = useCallback(() => {
    inFlightRef.current += 1;
    setRefreshing(true);
  }, []);

  const endBusy = useCallback(() => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    if (inFlightRef.current === 0 && mountedRef.current) {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate any in-flight connection attempt so it can't write settings
      // after the tab is gone.
      connectAttemptRef.current += 1;
      connectModalRef.current?.close();
    };
  }, []);

  // On-demand refresh through the store. Single-flight + TTL live in the store,
  // so callers just say "check now" (or force) without guarding races here — the
  // store returns a stable snapshot and notifies subscribers. Returns whether the
  // backend came back available, for the Connect flow to branch on.
  const refresh = useCallback(
    async (force: boolean) => {
      beginBusy();
      try {
        const snapshot = await refreshMiyoStatus({ force });
        return snapshot.backend === "available";
      } finally {
        endBusy();
      }
    },
    [beginBusy, endBusy]
  );

  // Explicit recovery after an unavailable verdict. A locally discovered Miyo
  // that restarted on a different port keeps failing every retry while the
  // discovery cache holds the dead endpoint, so drop it before probing again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/356
  const handleRetry = useCallback(async () => {
    MiyoServiceDiscovery.getInstance().invalidateLocalDiscovery();
    await refresh(true);
  }, [refresh]);

  const recordVault = useCallback(
    (registration: string, targetMode: "local" | "remote", url: string) => {
      setVaultResult({
        endpoint: `${targetMode}:${url}`,
        message:
          registration === "registered"
            ? "Current vault registered on this server."
            : targetMode === "remote"
              ? "Current vault isn't confirmed on this server. Manage folders on the Miyo host."
              : "",
      });
    },
    []
  );

  // Recheck synced settings and discard replies about an endpoint no longer selected.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
  useEffect(() => {
    let cancelled = false;
    void refresh(false).then(async (available) => {
      if (cancelled || !available || !settings.enableMiyo) return;
      const registration = await new MiyoClient().checkFolderRegistration(
        getMiyoFolderName(app),
        activeUrl || undefined
      );
      if (!cancelled) recordVault(registration, activeMode, activeUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, app, activeMode, activeUrl, settings.enableMiyo, recordVault]);

  // Direct reachability probe that BYPASSES the shouldUseMiyo gate. The status
  // store only probes once Miyo is enabled (its snapshot reflects the *effective*
  // backend), but Connect must check reachability *before* enabling — the same
  // direct isBackendAvailable() check the legacy Miyo toggle used. Returns
  // whether a local/remote Miyo instance answered a healthy /v0/health.
  const probeReachable = useCallback(async () => {
    beginBusy();
    try {
      return await new MiyoClient().isBackendAvailable(
        getMiyoCustomUrl(getSettings()) || undefined
      );
    } finally {
      endBusy();
    }
  }, [beginBusy, endBusy]);

  // Enable Miyo, then refresh the store so the pill flips to Connected.
  //
  // Two-phase commit: enabling persists `enableMiyo`, but search routing keys off
  // that persisted flag alone (shouldUseMiyo), so a flag left `true` after a
  // failed health check would route retrieval to a dead Miyo — silent empty
  // results with no self-heal until the next manual reconnect. So we roll back
  // `enableMiyo` whenever this call must not commit:
  //   - the post-enable refresh reports NOT available (dead Miyo), OR
  //   - a newer attempt / cancel / unmount superseded this one mid-refresh.
  //
  // But the revert itself must not clobber a SUPERSEDING enable. Concurrent
  // Connect/Retry presses share the store's single-flight refresh, so an older
  // call can resolve last; without ownership its `available === false` (or
  // superseded) revert would overwrite the newer call's committed `true`. So each
  // call claims `enableTxnRef`; it only reverts while it's still the owner. A
  // newer enable bumps the token first, so it owns the committed state and the
  // older revert is suppressed — while a plain cancel/unmount (no newer enable)
  // leaves this call as owner, so it still reverts correctly.
  //
  // `superseded` is the caller's generation guard. Returns post-enable availability.
  const enableMiyoBackend = useCallback(
    async (superseded: () => boolean) => {
      // The caller's lifecycle can expire while its preceding network check is
      // pending. Do not let an obsolete settings tree write into its successor.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
      if (superseded()) return false;
      const txn = (enableTxnRef.current += 1);
      const before = getSettings();
      const prevEnableMiyo = before.enableMiyo;
      updateSetting("enableMiyo", true);
      const available = await refresh(true);
      // A synced endpoint or disable also ends this optimistic transaction.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
      const current = getSettings();
      const stillOwner =
        enableTxnRef.current === txn &&
        current.enableMiyo &&
        getMiyoConnectionMode(current) === getMiyoConnectionMode(before) &&
        getMiyoCustomUrl(current) === getMiyoCustomUrl(before);
      if (stillOwner && (!available || superseded())) {
        updateSetting("enableMiyo", prevEnableMiyo);
      }
      return available;
    },
    [refresh]
  );

  // Register this vault with Miyo when it isn't known yet, so Connect adds it for
  // the user instead of sending them to do it by hand. A local Miyo can index the
  // vault's absolute path directly (POST /v0/folder); a remote Miyo can't see this
  // machine's disk, so we can only hand off to the add-folder deeplink. Returns
  // "added" when the vault is now registered (including the 409 already-registered
  // case) or "manual" when the caller must finish through the guided flow — remote
  // target, no desktop path (mobile), or a failed POST all fall back to manual.
  // Whether this vault can be registered with one click from here: a local Miyo
  // whose absolute vault path we can resolve. Remote Miyo / mobile (no
  // FileSystemAdapter) can't, so the addVault modal guides them to the deeplink.
  const canAutoAddVault = useCallback((): boolean => {
    return Boolean(getVaultBase(app)) && getMiyoConnectionMode(getSettings()) === "local";
  }, [app]);

  // Register this vault with Miyo (POST /v0/folder) on explicit user confirmation
  // from the addVault modal, then enable + report so the modal can close. Returns
  // "added" (registered and enabled — modal closes), "manual" (can't one-click
  // here — fall back to the deeplink guidance), "unreachable" (the POST succeeded
  // but Miyo couldn't be confirmed afterwards — the folder IS registered, so the
  // modal routes to the guide step, NOT a false "couldn't register"), or "error"
  // (the POST itself failed — stay put with a retry message). Bumps the connect
  // generation so a stale in-flight probe can't race the enable that follows.
  const registerVault = useCallback(async (): Promise<
    "added" | "manual" | "unreachable" | "error"
  > => {
    // The addVault modal holds the callback it was created with, so this
    // closure can predate an endpoint or Copilot-root change made while the
    // modal was open. Registering from that stale snapshot would target the
    // previous endpoint and exclude the previous roots, then enable an endpoint
    // this vault was never registered with.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
    const currentSettings = getSettings();
    const customUrl = getMiyoCustomUrl(currentSettings);
    const vaultBase = getVaultBase(app);
    if (
      !vaultBase ||
      getMiyoConnectionMode(currentSettings) === "remote" ||
      !isLocalMiyoUrl(customUrl)
    ) {
      return "manual";
    }
    const attempt = (connectAttemptRef.current += 1);
    const superseded = () =>
      connectAttemptRef.current !== attempt ||
      !mountedRef.current ||
      !plugin.isPluginLifecycleActive();
    try {
      // Keep Copilot's own roots and Obsidian-ignored paths out of Miyo's ranked
      // candidate pool. They can contain enough chunks to exhaust the server's
      // bounded result window before Copilot applies its local QA filter.
      // User-authored QA rules remain local; Miyo owns those folder rules
      // instead of receiving a snapshot Copilot cannot keep current.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
      const initialExclusions = [
        ...new Set(
          [...getSystemExcludedFolders(currentSettings), ...extractAppIgnoreSettings(app)]
            .map((folder) => folder.replace(/\\/g, "/").replace(/\/+$/, ""))
            // A bare root or parent pointer can make Miyo exclude the entire
            // vault. Preserve other path text literally so an inert Obsidian
            // pattern such as "./notes" is not broadened into an exclusion.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
            .filter((folder) => folder.length > 0 && folder !== "." && folder !== "..")
        ),
      ];
      await new MiyoClient({ plusLicenseKey: currentSettings.plusLicenseKey }).addFolder(
        {
          path: vaultBase,
          exclude_folders: initialExclusions,
          // Remote read (Relay) is enabled by default so a user who turns on
          // Miyo's Relay connector — itself an explicit, paid, signed-in opt-in
          // (ChatGPT/Claude linked once) — gets cloud access to this vault without
          // re-configuring it per folder. It's inert until Relay is actually on, so
          // it doesn't expose anything on its own; the register modal states this
          // plainly rather than promising absolute privacy. A user who wants this
          // vault kept out of Relay can flip allow_remote_read off per folder in Miyo.
          allow_remote_read: true,
        },
        customUrl || undefined,
        () => {
          // URL discovery and credential lookup are asynchronous. Re-check at
          // the request boundary so a settings tree owned by an unloaded plugin
          // cannot register its stale vault in the successor lifecycle.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
          if (superseded()) {
            throw new Error("Miyo registration lifecycle expired");
          }
        }
      );
      if (superseded()) return "unreachable";
      // Registration can make semantic results available without changing the
      // endpoint or its healthy status. Retry any Relevant Notes request that
      // previously settled on setup guidance.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      notifyMiyoIndexChanged();
    } catch (error) {
      if (superseded()) return "unreachable";
      logWarn(`Miyo add-folder failed: ${err2String(error)}`);
      return "error";
    }
    // Registered → enable, mirroring attemptConnection's post-registration path.
    // Past this point the folder IS registered on the server, so a failure to
    // confirm reachability is "unreachable" (guide the user to start Miyo), never
    // "error" (which reads as "couldn't register" and contradicts the server).
    if (superseded()) return "unreachable";
    const available = await enableMiyoBackend(superseded);
    if (superseded()) return "unreachable";
    return available ? "added" : "unreachable";
  }, [app, plugin, enableMiyoBackend]);

  // One connection attempt: probe reachability, then (if reachable) check whether
  // this vault is registered with Miyo. An unregistered vault is NOT auto-added —
  // the caller opens the addVault modal so the user confirms the registration
  // (one click, which then runs `registerVault`). Guarded by a generation token:
  // an attempt superseded by a newer one (or by unmount/cancel/URL change/
  // disconnect) resolves to the internal `"superseded"` sentinel so it neither
  // writes settings past the guard, routes the UI, nor raises a Notice — the
  // newer attempt owns the outcome.
  const attemptConnection = useCallback(async (): Promise<ConnectOutcome | "superseded"> => {
    const attempt = (connectAttemptRef.current += 1);
    const target = getSettings();
    const remote = getMiyoConnectionMode(target) === "remote";
    const superseded = () =>
      connectAttemptRef.current !== attempt ||
      getMiyoConnectionMode(getSettings()) !== getMiyoConnectionMode(target) ||
      getMiyoCustomUrl(getSettings()) !== getMiyoCustomUrl(target) ||
      !mountedRef.current ||
      !plugin.isPluginLifecycleActive();

    let reachable = await probeReachable();
    if (!reachable && target.enableMiyo) reachable = await refresh(true);
    if (superseded()) return "superseded";
    if (!reachable) return "unreachable";

    const registration = await new MiyoClient().checkFolderRegistration(
      getMiyoFolderName(app),
      getMiyoCustomUrl(target) || undefined
    );
    if (superseded()) return "superseded";
    // Server reachability does not imply this vault exists on the remote host.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
    recordVault(registration, getMiyoConnectionMode(target), getMiyoCustomUrl(target));
    if (registration === "error" && !remote) return "error";
    // Unregistered → hand off to the addVault modal for explicit confirmation
    // rather than silently registering the folder.
    if (registration === "unregistered" && !remote) return "needs-add";

    // Registered → enable. The lifecycle guard prevents a cancel, unmount, or
    // plugin unload from flipping enableMiyo on.
    const available = await enableMiyoBackend(superseded);
    // A newer attempt may have started during the enable refresh — don't let this
    // stale result drive the UI (close the modal / bounce a step). enableMiyoBackend
    // has already rolled its optimistic writes back in that case.
    if (superseded()) return "superseded";
    // Miyo may have dropped between registration and this refresh; only claim
    // "connected" when the backend is actually available now.
    return available ? "connected" : "unreachable";
  }, [app, plugin, probeReachable, enableMiyoBackend, refresh, recordVault]);

  // Wraps attemptConnection with the shared error affordance so both entry points
  // (Connect button, modal Retry) surface the same Notice on an indeterminate
  // result. A `"superseded"` attempt is silent — no Notice, no routing — and maps
  // to `"error"` so the modal treats it as "stay put".
  const handleEvaluate = useCallback(async (): Promise<ConnectOutcome> => {
    const outcome = await attemptConnection();
    if (outcome === "superseded") {
      return "error";
    }
    if (outcome === "error" && mountedRef.current) {
      new Notice("Couldn't confirm this vault with Miyo. Please try again.");
    }
    return outcome;
  }, [attemptConnection]);

  // Open the Connect modal at the given step. The modal owns the guide ⇄ addVault
  // transitions and closes itself on success; its Retry re-runs handleEvaluate,
  // and its "Add this vault" button runs registerVault (local one-click).
  const openConnectModal = useCallback(
    (initialStep: ConnectStep) => {
      connectModalRef.current?.close();
      const modal = new MiyoConnectModal(app, {
        initialStep,
        downloadUrl: createMiyoPageUrl("connection"),
        canAutoAdd: canAutoAddVault(),
        onClose: () => {
          // Closing (Cancel / ESC / header X / after connecting) invalidates any
          // in-flight attempt so a probe still running when the user dismisses the
          // modal can't flip enableMiyo on afterward.
          connectAttemptRef.current += 1;
          if (connectModalRef.current === modal) {
            connectModalRef.current = null;
          }
        },
        onRetry: () => handleEvaluate(),
        onAddVault: () => registerVault(),
      });
      connectModalRef.current = modal;
      modal.open();
    },
    [app, canAutoAddVault, handleEvaluate, registerVault]
  );

  // Local setup can open the app; remote setup stays here with host instructions.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
  const handleConnect = useCallback(async () => {
    setConnectionError(null);
    const outcome = await handleEvaluate();
    if (!mountedRef.current) return;
    if (getMiyoConnectionMode(getSettings()) === "remote") {
      if (outcome === "unreachable")
        setConnectionError({
          endpoint: `remote:${getSettings().miyoServerUrl}`,
          message:
            "Couldn't connect to this server. Check the address, access, and that Miyo is running, then retry.",
        });
      return;
    }
    if (outcome === "needs-add") {
      openConnectModal("addVault");
    } else if (outcome === "unreachable") {
      openConnectModal("guide");
    }
    // "connected": pill flips via the store; "error": Notice already surfaced.
  }, [handleEvaluate, openConnectModal]);

  // Disconnect: turn Miyo off — the symmetric undo of enableMiyoBackend. The
  // store's subscription invalidates the snapshot; refresh(true) then reflects
  // the disconnected state.
  const handleDisconnect = useCallback(async () => {
    enableTxnRef.current += 1;
    // Invalidate any in-flight connect attempt so a late-resolving probe can't
    // re-enable Miyo right after the user turned it off.
    connectAttemptRef.current += 1;
    updateSetting("enableMiyo", false);
    await refresh(true);
  }, [refresh]);

  // The feature gate shares built-in reconciliation so this tab cannot recreate
  // skills the user disabled, or create directories for unconfigured agents.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  const handleToggleSearchSkill = useCallback(async (next: boolean) => {
    const attempt = ++skillAttemptRef.current;
    setPendingSkillEnabled(next);
    const previous = getSettings().enableMiyoSearchSkill;
    try {
      // Keep desktop-only agent modules out of the mobile settings bundle.
      const { SkillManager } = await import("@/agentMode");
      if (skillAttemptRef.current !== attempt || !mountedRef.current) return;
      updateSetting("enableMiyoSearchSkill", next);
      const result = await SkillManager.getInstance().refresh(true);
      if (!result.ok || result.reconcileErrorCount > 0) {
        throw new Error("Could not reconcile Miyo search skill files.");
      }
    } catch {
      // Failed enables must not leave the system prompt advertising an uninstalled skill.
      // Disable intent survives cleanup failures. https://github.com/logancyang/obsidian-copilot/issues/3022
      if (next && skillAttemptRef.current === attempt) {
        updateSetting("enableMiyoSearchSkill", previous);
      }
      if (mountedRef.current && skillAttemptRef.current === attempt) {
        new Notice(
          next
            ? "Couldn't update the Miyo search skill. Please try again."
            : "Miyo search preference saved, but skill files could not be updated. Check Skills settings and try again."
        );
      }
    } finally {
      if (mountedRef.current && skillAttemptRef.current === attempt) setPendingSkillEnabled(null);
    }
  }, []);

  const changeConnection = (nextMode: "local" | "remote", address = urlDraft) => {
    connectAttemptRef.current += 1;
    enableTxnRef.current += 1;
    connectModalRef.current?.close();
    setConnectionError(null);
    setVaultResult(null);
    if (getSettings().enableMiyo) updateSetting("enableMiyo", false);
    if (nextMode === "local" && getMiyoConnectionMode(getSettings()) !== "local")
      updateSetting("miyoConnectionMode", "local");
    const current = getSettings();
    setDraft({
      mode: nextMode,
      address,
      source: `${getMiyoConnectionMode(current)}:${current.miyoServerUrl}`,
    });
  };

  const saveAndConnect = async () => {
    const address = urlDraft.trim();
    if (mode === "remote") {
      try {
        const url = new URL(address);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          !url.hostname ||
          url.username ||
          url.password
        )
          throw new Error("Invalid server address");
      } catch {
        setConnectionError({
          endpoint: `${mode}:${urlDraft}`,
          message: "Enter a valid HTTP or HTTPS server address, without embedded credentials.",
        });
        return;
      }
    }
    connectAttemptRef.current += 1;
    MiyoServiceDiscovery.getInstance().invalidateLocalDiscovery();
    setSettings({
      miyoConnectionMode: mode,
      ...(mode === "remote" ? { miyoServerUrl: address } : {}),
    });
    setDraft(null);
    await handleConnect();
  };

  // `stale` counts as still-connected for the UI gate: it means "was available,
  // snapshot just aged past the TTL", not "confirmed disconnected". The store
  // downgrades available→stale lazily on read (no notification at the 60s mark),
  // so ANY unrelated re-render past the horizon — e.g. toggling Search scope —
  // would otherwise flip the whole tab to "disconnected" until the next probe.
  // Runtime safety is unaffected: capability routing uses
  // `isMiyoAvailableForCapability` (strict `=== "available"`), not this gate.
  const capabilitiesEnabled = status.backend === "available" || status.backend === "stale";
  // Remote is the user's explicit selection, including a forwarded loopback URL.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
  const connectedRemote = mode === "remote";

  return (
    <div className="tw-space-y-4">
      <div className="tw-text-sm tw-text-muted">
        Private context from your Miyo server. Unlimited, no credits.
      </div>

      {/* Connection */}
      <SettingSection label="Connection">
        <CapabilityRow
          title="Miyo"
          description={
            <span>
              Connect to Miyo on this computer or use a server address under Advanced. Need the
              local app?{" "}
              <a
                href={createMiyoPageUrl("miyo_settings")}
                target="_blank"
                rel="noopener noreferrer"
                className="tw-inline-flex tw-items-center tw-gap-0.5 tw-text-accent"
              >
                Download <ArrowUpRight className="tw-size-3.5" />
              </a>
            </span>
          }
          control={
            <MiyoConnectionControl
              enabled={settings.enableMiyo}
              status={status.backend}
              checking={refreshing}
              remote={connectedRemote}
              connectLabel={connectedRemote ? "Save and connect" : "Connect"}
              onConnect={() => void saveAndConnect()}
              onDisconnect={() => void handleDisconnect()}
              onRetry={() => void (connectedRemote ? saveAndConnect() : handleRetry())}
            />
          }
        />
        <div className="tw-space-y-2 tw-py-2 tw-text-xs">
          {connectionError?.endpoint === `${mode}:${urlDraft}` && (
            <div role="alert" className="tw-text-error">
              {connectionError.message}
            </div>
          )}
          {settings.enableMiyo &&
            capabilitiesEnabled &&
            !refreshing &&
            vaultResult?.endpoint === `${activeMode}:${activeUrl}` && (
              <div className="tw-text-muted">{vaultResult.message}</div>
            )}
        </div>

        {/* Connector — relay status from the Miyo health check. Lives in
            Connection (not the gated block) because it's a connection affordance:
            gating it behind "connected" would deadlock setup. */}
        <MiyoStatusRow
          title={
            <>
              Connector <RelayTag />
            </>
          }
          description="Let ChatGPT / Claude read-write your local files and vault from the cloud."
          status={status.connector}
          statusText={connectorStatusText(status.connector)}
          actionLabel="Set up in Miyo"
          remoteInstruction={connectedRemote ? "Set up Relay on the Miyo host." : undefined}
          onAction={() => window.open(MIYO_CONNECT_DEEPLINK_URL, "_blank")}
        />

        {/* Advanced — the remote Miyo URL is an escape hatch, tucked away by default. */}
        <div>
          <SettingDisclosure open={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)} />

          {advancedOpen && (
            <div className="tw-pb-2">
              {/* Standard setting row (label/description left, control right) —
                  the input is controlled + commits on blur, so it uses
                  SettingItem's `custom` slot rather than the debounced text mode. */}
              <SettingItem
                type="custom"
                title="Remote Miyo server (advanced)"
                description="Leave blank for local discovery, or enter a remote server address. Select Connect above to save and check it."
              >
                <Input
                  value={urlDraft}
                  onChange={(event) =>
                    changeConnection(
                      event.target.value.trim() ? "remote" : "local",
                      event.target.value
                    )
                  }
                  aria-label="Server address"
                  placeholder="Leave blank for local discovery"
                  className="tw-w-full sm:tw-w-[260px]"
                />
              </SettingItem>
            </div>
          )}
        </div>
      </SettingSection>

      {/* Powered by Miyo — the capability block. Partial gating: the Miyo pickers /
          status dim when disconnected, but the Document Processor output path stays
          editable (it applies to Plus document conversion too), so this can't use
          SettingSection's all-or-nothing `gated`. */}
      <div className="tw-space-y-2">
        <div className="tw-text-xs tw-font-semibold tw-text-muted">Powered by Miyo</div>
        <div className="tw-text-sm tw-text-muted">
          <span className="tw-font-semibold tw-text-normal">Plus</span> = Copilot cloud, uses
          credits · <span className="tw-font-semibold tw-text-accent">Miyo</span> = your selected
          server, no credits
        </div>

        <MiyoAvailabilityNotice
          enabled={settings.enableMiyo}
          available={capabilitiesEnabled}
          checking={refreshing}
        />

        <div className="tw-overflow-hidden tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-sm">
          {/* The card is split by connection dependency. The outer `tw-divide-y`
              draws the rule between the always-on Semantic search row and the
              connection-gated group below it. */}
          <div className="tw-divide-y tw-divide-border">
            {/* Semantic search — installs/removes the `miyo-search` agent skill
                (path B). ENABLING is connection-gated (the skill only has any
                effect once Miyo is reachable), but DISABLING an already-installed
                skill must stay available even offline: removal is a local vault
                file operation that doesn't depend on Miyo's health, and a user
                whose Miyo went offline must still be able to turn it off. So the
                gate keys on "can this action run": always usable when already
                enabled (to allow turn-off), else gated on `capabilitiesEnabled`
                (to allow turn-on). Desktop-only (agents + skills are
                desktop-gated). */}
            {(() => {
              const skillToggleUsable = settings.enableMiyoSearchSkill || capabilitiesEnabled;
              return (
                <div
                  className={cn(
                    "tw-px-4",
                    !skillToggleUsable && "tw-pointer-events-none tw-opacity-45"
                  )}
                  aria-disabled={!skillToggleUsable}
                >
                  <CapabilityRow
                    title="Semantic search"
                    description="Understands meaning, not just keywords — finds related notes with Miyo."
                    control={
                      <SettingSwitch
                        checked={pendingSkillEnabled ?? settings.enableMiyoSearchSkill}
                        onCheckedChange={(next) => void handleToggleSearchSkill(next)}
                        disabled={
                          Platform.isMobile || !skillToggleUsable || pendingSkillEnabled !== null
                        }
                        aria-label="Enable Miyo semantic search skill"
                      />
                    }
                  />
                </div>
              );
            })()}

            {/* Connection-gated group. DESIGN NOTE — the gate is layered: the
                wrapper's pointer-events-none + opacity is only the visual/mouse
                gate, while each interactive child ALSO passes an explicit
                `disabled` (the wrapper alone doesn't block keyboard focus or
                programmatic activation). Any NEW interactive child added here MUST
                also take `disabled`. `opacity-45` creates a stacking context, so
                keeping Semantic search out of this div is what lets it stay fully
                opaque and clickable while these rows dim. */}
            <div
              className={cn(
                "tw-divide-y tw-divide-border [&>*]:tw-px-4",
                !capabilitiesEnabled && "tw-pointer-events-none tw-opacity-45"
              )}
              aria-disabled={!capabilitiesEnabled}
            >
              {/* Search scope — bound to `miyoSearchAll` (true omits folder_name so
                  Miyo searches everything it has indexed). Gated on the connection so
                  the control stays keyboard-inert while dimmed. */}
              <CapabilityRow
                indented
                title={
                  <span className="tw-flex tw-items-center tw-gap-1.5">
                    <CornerDownRight className="tw-size-3 tw-text-faint" />
                    Search scope
                  </span>
                }
                description="Only the current vault, or everything Miyo has indexed."
                control={
                  <SegmentedControl
                    aria-label="Search scope"
                    options={[
                      { label: "Current vault", value: "current" },
                      { label: "Unrestricted", value: "unrestricted" },
                    ]}
                    value={settings.miyoSearchAll ? "unrestricted" : "current"}
                    onChange={(value) => updateSetting("miyoSearchAll", value === "unrestricted")}
                    disabled={!capabilitiesEnabled}
                  />
                }
              />

              {/* Search chat — chat-sync status from the Miyo health check. Its
                  deeplink button also takes `disabled` so the gate holds for
                  keyboard users, not just pointer. */}
              <MiyoStatusRow
                title="Search chat"
                description="Search your ChatGPT / Claude chats indexed by Miyo."
                status={status.chatSync}
                statusText={chatSyncStatusText(status.chatSync)}
                actionLabel="Manage in Miyo"
                remoteInstruction={
                  connectedRemote ? "Manage chat sources on the Miyo host." : undefined
                }
                onAction={() => window.open(MIYO_CHATS_DEEPLINK_URL, "_blank")}
                disabled={!capabilitiesEnabled}
              />
            </div>

            {/* Document Processor — NOT connection-gated: it's a Plus-vs-Miyo
                choice, not a Miyo-only capability, so it stays selectable even
                when Miyo is unavailable. That lets a user switch back to Plus to
                recover from a fail-closed parse error (resolveDocProcessorBackend
                surfaces "reconnect Miyo or switch to Plus"). The persisted field
                is honored at the parse boundary; the picker only sets the
                preference. */}
            <div className="tw-px-4">
              <CapabilityRow
                title="Document Processor"
                description="Miyo processes PDF & EPUB. Other formats use Plus cloud."
                control={
                  <SegmentedControl
                    aria-label="Document Processor backend"
                    options={[
                      { label: "Plus", value: "plus" },
                      { label: "Miyo", value: "miyo" },
                    ]}
                    value={settings.docProcessorBackend}
                    onChange={(value) => updateSetting("docProcessorBackend", value)}
                  />
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
