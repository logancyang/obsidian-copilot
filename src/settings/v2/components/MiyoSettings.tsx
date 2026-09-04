import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { MIYO_HOMEPAGE_URL } from "@/constants";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { MiyoServiceDiscovery } from "@/miyo/MiyoServiceDiscovery";
import { type CapabilityStatus, refreshMiyoStatus } from "@/miyo/miyoStatusStore";
import {
  assertCurrentLifecycle,
  enqueueMiyoFolderMutation,
  resyncMiyoFolder,
  verifyMiyoScope,
} from "@/miyo/miyoResync";
import {
  buildMiyoSyncReceipt,
  getMiyoCustomUrl,
  getMiyoFolderExclusions,
  getMiyoFolderInclusions,
  getMiyoFolderName,
  isLocalMiyoUrl,
  MIYO_CHATS_DEEPLINK_URL,
  MIYO_CONNECT_DEEPLINK_URL,
  shouldSurfaceMiyoResync,
} from "@/miyo/miyoUtils";
import { useMiyoStatus } from "@/miyo/useMiyoStatus";
import { notifyMiyoIndexChanged } from "@/miyo/miyoIndex";
import { deriveSkillsFolder } from "@/settings/copilotFolder";
import { getSettings, updateSetting, useSettingsValue } from "@/settings/model";
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
import { extractAppIgnoreSettings, getSystemExcludedFolders } from "@/search/searchUtils";
import { ArrowUpRight, CornerDownRight, TriangleAlert } from "lucide-react";
import { Notice, Platform } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";

/** Landing page for users who don't have Miyo installed yet. */
const MIYO_DOWNLOAD_URL = MIYO_HOMEPAGE_URL;

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
  const settings = useSettingsValue();
  const status = useMiyoStatus();

  // From the plugin, not captured here: this tab mounts the first time the user
  // selects it, which in a settings tree that outlived a reload is a different
  // lifecycle than the one this tree belongs to.
  const { miyoMutationSession } = usePlugin();

  // Draft + blur commit so we persist once on blur, not on every keystroke.
  const [urlDraft, setUrlDraft] = useState(settings.miyoServerUrl || "");
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
      // Deliberately DON'T advance skillAttemptRef here. An in-flight search-skill
      // install/remove must still reconcile its completed disk result to the
      // persisted flag after unmount (mountedRef gates only the UI updates);
      // bumping the token would make it look superseded and skip that persist,
      // leaving disk and flag divergent.
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

  // Refresh on mount so an already-running Miyo shows Connected without a click.
  // TTL-gated inside the store, so re-mounting the tab won't spam health checks.
  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  // ── Miyo scope resync ──
  // Server-verified staleness from the on-mount check; null = unverified /
  // unreachable → the banner falls back to the local receipt-mismatch signal.
  const [serverScopeStale, setServerScopeStale] = useState<boolean | null>(null);
  const [resyncPending, setResyncPending] = useState(false);
  const [scopeVerifyNonce, setScopeVerifyNonce] = useState(0);

  // Forces the verify below to run again when the live record may have changed
  // without any local input moving — see the call sites for the two cases.
  const invalidateScopeVerdict = useCallback(() => setScopeVerifyNonce((n) => n + 1), []);

  // Verify the live record on mount AND whenever an input the verdict was
  // derived from moves underneath it: the Miyo endpoint, the system roots the
  // record is checked against, or an explicit invalidation. The verdict is a
  // sticky veto — a `false` suppresses the local mismatch banner outright — so
  // a verdict formed against inputs that no longer hold must not answer for the
  // current ones; it is reset before re-verifying (the `cancelled` flag drops
  // results from a superseded run). Keying on the roots also covers the async
  // tail of a root change: `applyCopilotRootChange` persists to disk before it
  // flips the in-memory root, and the user can open this tab inside that window,
  // so the new root can land while this component stays mounted.
  //
  // The live record outranks local signals in both directions: a covering
  // record silently self-heals a mismatched receipt (e.g. another device's
  // receipt arrived via sync), and a stale record forces the banner even when
  // local state looks clean (Reset Settings wiped the receipt, or the
  // registration predates receipts).
  const miyoEndpointUrl = getMiyoCustomUrl(settings);
  // Only the system roots: they are what the record is checked against
  // (`miyoRecordCoversSystemRoots`). The receipt is deliberately NOT part of
  // this key — a "covered" verdict writes the receipt itself, which would
  // re-trigger the effect forever.
  const verifiedRootsKey = [...getSystemExcludedFolders(settings)].sort().join("\n");
  useEffect(() => {
    /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- reset the stale verdict when the inputs it was derived from change underneath us */
    setServerScopeStale(null);
    /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resume checking after resetting derived verification state */
    // No local-only gate: the verify is a read-only lookup that works against a
    // remote Miyo too, and it's the only way a remote user's banner can ever
    // clear (they have no local register flow to write a receipt). Unreachable
    // endpoints resolve to "unknown" and fall back to the local signal. Only
    // the Resync button's delete/re-add stays gated on canAutoAddVault.
    let cancelled = false;
    void verifyMiyoScope(app, miyoMutationSession).then((verdict) => {
      if (cancelled || !mountedRef.current) return;
      if (verdict === "stale") setServerScopeStale(true);
      else if (verdict === "covered" || verdict === "unregistered") setServerScopeStale(false);
    });
    return () => {
      cancelled = true;
    };
  }, [app, miyoEndpointUrl, miyoMutationSession, verifiedRootsKey, scopeVerifyNonce]);

  const handleResync = useCallback(async () => {
    setResyncPending(true);
    try {
      const outcome = await resyncMiyoFolder(app, miyoMutationSession);
      if (!mountedRef.current) return;
      switch (outcome) {
        case "verified":
          new Notice("Miyo is already in sync with your Copilot folders.");
          setServerScopeStale(false);
          break;
        case "resynced":
          new Notice("Miyo resynced — excluded folders updated, re-index started.");
          setServerScopeStale(false);
          break;
        case "resynced-scan-failed":
          new Notice("Miyo resynced; indexing will catch up on Miyo's next scan.");
          setServerScopeStale(false);
          break;
        case "resynced-grants-reset":
          // The rebuild could not recover this folder's Miyo-side permissions,
          // so they were reset to off. Say so plainly: a user who had remote
          // read enabled would otherwise keep believing it still is.
          new Notice(
            "Miyo resynced. This folder's registration had to be rebuilt, so its " +
              "remote read and write access were turned off — re-enable them in the Miyo app if you want them.",
            10000
          );
          setServerScopeStale(false);
          break;
        case "conflict":
          new Notice(
            "Miyo reports a conflicting registration (possibly under this vault's previous name). " +
              "Remove it in the Miyo app, then retry."
          );
          break;
        case "unregistered":
          // Nothing on the server exposes this vault, so the stale banner can
          // clear; re-registering is the register flow's job (explicit consent).
          new Notice("This vault isn't registered with Miyo. Reconnect to register it.");
          setServerScopeStale(false);
          break;
        case "failed":
          new Notice("Couldn't resync Miyo. Make sure Miyo is running, then retry.");
          break;
      }
    } finally {
      if (mountedRef.current) setResyncPending(false);
    }
  }, [app, miyoMutationSession]);

  // Direct reachability probe that BYPASSES the shouldUseMiyo gate. The status
  // store only probes once Miyo is enabled (its snapshot reflects the *effective*
  // backend), but Connect must check reachability *before* enabling — the same
  // direct isBackendAvailable() check the legacy Miyo toggle used. Returns
  // whether a local/remote Miyo instance answered a healthy /v0/health.
  const probeReachable = useCallback(async () => {
    beginBusy();
    try {
      return await new MiyoClient().isBackendAvailable(getMiyoCustomUrl(settings) || undefined);
    } finally {
      endBusy();
    }
  }, [settings, beginBusy, endBusy]);

  // Enable Miyo, then refresh the store so the pill flips to Connected. This is
  // the write the legacy Miyo toggle owned; the redesign moved the affordance
  // here but the enable action still has to persist the flag.
  //
  // Keep writing the legacy `enableSemanticSearchV3` field alongside `enableMiyo`
  // until the settings migration removes the old semantic-index fields. Runtime
  // search routing now depends on `enableMiyo` alone.
  //
  // Two-phase commit: enabling persists `enableMiyo`, but search routing keys off
  // that persisted flag alone (shouldUseMiyo), so a flag left `true` after a
  // failed health check would route retrieval to a dead Miyo — silent empty
  // results with no self-heal until the next manual reconnect. So we roll back
  // exactly the fields this call flipped — always `enableMiyo`, and
  // `enableSemanticSearchV3` only if WE turned it on (a user who had it on for
  // non-Miyo semantic search keeps it) — whenever this call must not commit:
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
      const txn = (enableTxnRef.current += 1);
      const prevEnableMiyo = settings.enableMiyo;
      const flippedSemantic = !settings.enableSemanticSearchV3;
      updateSetting("enableMiyo", true);
      if (flippedSemantic) {
        updateSetting("enableSemanticSearchV3", true);
      }
      const available = await refresh(true);
      const stillOwner = enableTxnRef.current === txn;
      if (stillOwner && (!available || superseded())) {
        updateSetting("enableMiyo", prevEnableMiyo);
        if (flippedSemantic) {
          updateSetting("enableSemanticSearchV3", false);
        }
      }
      return available;
    },
    [settings.enableMiyo, settings.enableSemanticSearchV3, refresh]
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
    return Boolean(getVaultBase(app)) && isLocalMiyoUrl(getMiyoCustomUrl(settings));
  }, [app, settings]);

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
    const customUrl = getMiyoCustomUrl(settings);
    const vaultBase = getVaultBase(app);
    if (!vaultBase || !isLocalMiyoUrl(customUrl)) {
      return "manual";
    }
    const attempt = (connectAttemptRef.current += 1);
    const superseded = () => connectAttemptRef.current !== attempt || !mountedRef.current;
    try {
      // DESIGN NOTE: the filters below are a REGISTRATION-TIME SNAPSHOT of the
      // current scope, sent only on this first POST; registered folders are never
      // PATCHed when scope changes later. The two sources drift differently:
      //   - qaInclusions/qaExclusions: SAFE to snapshot. MiyoSemanticRetriever
      //     re-applies the LIVE qa* scope at query time (filterByCopilotPatterns),
      //     so even if Miyo's index drifts after a qa* change, retrieval results
      //     still honor the current scope.
      //   - Obsidian userIgnoreFilters (extractAppIgnoreSettings): NOT re-applied
      //     at query time (shouldIndexFile ignores them), so this snapshot is the
      //     ONLY thing that scopes them. Editing Obsidian's "Excluded files" after
      //     registration therefore does NOT retroactively hide already-indexed
      //     content from Miyo until re-registration — a real (if narrow) gap for a
      //     path excluded post-registration while Relay is on. Closing it properly
      //     needs either a query-time userIgnoreFilters filter in the retriever or
      //     an idempotent folder-filter re-sync; both are out of this PR's scope.
      //     If a review flags this again, point them at this note.
      // Serialized with resync runs: the Resync button's DELETE/POST must never
      // interleave with this registration. The task reads settings when it RUNS,
      // not when it is queued — it can sit behind an
      // in-flight mutation, and a root/endpoint change landing in that window
      // would otherwise be submitted as an already-stale scope (with a receipt
      // vouching for it). Mirrors resyncMiyoFolder's execution-time fresh read;
      // the receipt is built from the same snapshot as the submitted body so it
      // always describes what the server actually holds.
      const submission = await enqueueMiyoFolderMutation(async (lifecycle) => {
        const fresh = getSettings();
        const freshUrl = getMiyoCustomUrl(fresh);
        // DESIGN NOTE — a remote flip mid-queue surfaces as the retryable
        // "error" outcome, NOT as a "manual" modal transition. Reaching this
        // throw needs a double race: the modal blocks local edits, so only a
        // synced-in endpoint change can land here, and only while the mutation
        // chain is already busy. Recovery is close-and-reopen (canAutoAdd
        // re-derives to false → manual deeplink guidance); nothing was
        // submitted to the wrong target. Extending MiyoConnectModal's outcome
        // routing with a mid-flight canAutoAdd downgrade for this corner is
        // deliberately rejected — and a direct deeplink open after the queued
        // await would have lost user activation anyway.
        // If a future review flags this again, point them at this note.
        if (!isLocalMiyoUrl(freshUrl)) {
          throw new Error(
            "Miyo endpoint switched to a remote target while registration was queued"
          );
        }
        // Snapshot the credential alongside the endpoint: this registration is
        // queued and can outlive the vault that asked for it, while the auth
        // header is otherwise read live per request. The lifecycle check rides
        // on `addFolder`'s `beforeRequest` below — it fires after URL resolution
        // and decryption, so unlike a check here it cannot go stale before the
        // POST leaves. It is separate from `superseded()` above: that tracks the
        // UI's own attempt generation, this one whether the vault is still open.
        const created = await new MiyoClient({ plusLicenseKey: fresh.plusLicenseKey }).addFolder(
          {
            path: vaultBase,
            // Remote read (Relay) is enabled by default so a user who turns on
            // Miyo's Relay connector — itself an explicit, paid, signed-in opt-in
            // (ChatGPT/Claude linked once) — gets cloud access to this vault without
            // re-configuring it per folder. It's inert until Relay is actually on, so
            // it doesn't expose anything on its own; the register modal states this
            // plainly rather than promising absolute privacy. A user who wants this
            // vault kept out of Relay can flip allow_remote_read off per folder in Miyo.
            allow_remote_read: true,
            ...getMiyoFolderInclusions(fresh.qaInclusions),
            // Project the always-on system root exclusions (active + historical
            // Copilot roots) alongside Obsidian's own ignore folders, so a former
            // root's content isn't uploaded for indexing. This is a registration-
            // time snapshot; MiyoSemanticRetriever re-applies the LIVE scope
            // (createCopilotPatternFilter, which also enforces these roots) at
            // query time, so correctness never depends on the snapshot.
            ...getMiyoFolderExclusions(fresh.qaExclusions, [
              ...getSystemExcludedFolders(fresh),
              ...extractAppIgnoreSettings(app),
            ]),
          },
          freshUrl || undefined,
          () => assertCurrentLifecycle(lifecycle)
        );
        return { created, receipt: buildMiyoSyncReceipt(app, fresh) };
      }, miyoMutationSession);
      // Record the sync receipt only for a fresh 201 — a 409 (already
      // registered) means the server holds an EARLIER snapshot whose exclusions
      // are unknown and possibly stale; marking it synced would silence the
      // resync prompt over a stale scope. Written before the enable step and
      // regardless of `superseded()`: the server-side registration DID happen
      // with this exact body, whatever the UI does afterwards.
      if (submission.created !== null) {
        updateSetting("miyoSyncedExclusions", submission.receipt);
      }
      // Registration can make semantic results available without changing the
      // endpoint or its healthy status. Retry any Relevant Notes request that
      // previously settled on setup guidance.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
      notifyMiyoIndexChanged();
    } catch (error) {
      logWarn(`Miyo add-folder failed: ${err2String(error)}`);
      return "error";
    }
    // Registered → enable, mirroring attemptConnection's post-registration path.
    // Past this point the folder IS registered on the server, so a failure to
    // confirm reachability is "unreachable" (guide the user to start Miyo), never
    // "error" (which reads as "couldn't register" and contradicts the server).
    if (superseded()) return "unreachable";
    // The record just changed (201) or turned out to pre-exist with unknown
    // exclusions (409, which deliberately leaves the receipt empty above). The
    // standing verdict was formed against the record as it was before either,
    // so it must not keep vetoing the banner.
    invalidateScopeVerdict();
    const available = await enableMiyoBackend(superseded);
    if (superseded()) return "unreachable";
    return available ? "added" : "unreachable";
  }, [app, settings, enableMiyoBackend, invalidateScopeVerdict, miyoMutationSession]);

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
    const superseded = () => connectAttemptRef.current !== attempt || !mountedRef.current;

    const reachable = await probeReachable();
    if (superseded()) return "superseded";
    if (!reachable) return "unreachable";

    const registration = await new MiyoClient().checkFolderRegistration(
      getMiyoFolderName(app),
      getMiyoCustomUrl(settings) || undefined
    );
    if (superseded()) return "superseded";
    if (registration === "error") return "error";
    // Unregistered → hand off to the addVault modal for explicit confirmation
    // rather than silently registering the folder.
    if (registration === "unregistered") return "needs-add";

    // Registered → enable. Re-check the guard right before the settings write so a
    // cancel/unmount that landed during the check can't flip enableMiyo on.
    if (superseded()) return "superseded";
    // This tab never registered the vault, so the record is one the user created
    // in the Miyo app — its exclusions are unknown and no local input moved to
    // signal that. Re-verify instead of trusting a verdict formed when the
    // record was absent (or was a different record entirely).
    invalidateScopeVerdict();
    const available = await enableMiyoBackend(superseded);
    // A newer attempt may have started during the enable refresh — don't let this
    // stale result drive the UI (close the modal / bounce a step). enableMiyoBackend
    // has already rolled its optimistic writes back in that case.
    if (superseded()) return "superseded";
    // Miyo may have dropped between registration and this refresh; only claim
    // "connected" when the backend is actually available now.
    return available ? "connected" : "unreachable";
  }, [app, settings, probeReachable, enableMiyoBackend, invalidateScopeVerdict]);

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
        downloadUrl: MIYO_DOWNLOAD_URL,
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

  // Connect: probe + registration check now. Registered → enabled inline, no
  // modal. Unregistered → the addVault modal to confirm registration (one-click
  // local, or deeplink guidance for remote/mobile); unreachable → the guide to
  // start Miyo; error → Notice (already shown).
  const handleConnect = useCallback(async () => {
    const outcome = await handleEvaluate();
    if (!mountedRef.current) return;
    if (outcome === "needs-add") {
      openConnectModal("addVault");
    } else if (outcome === "unreachable") {
      openConnectModal("guide");
    }
    // "connected": pill flips via the store; "error": Notice already surfaced.
  }, [handleEvaluate, openConnectModal]);

  // Disconnect: turn Miyo off — the symmetric undo of enableMiyoBackend. Keep
  // clearing the legacy semantic flag until the settings migration removes it.
  // The store's subscription invalidates the snapshot; refresh(true) then
  // reflects the disconnected state.
  const handleDisconnect = useCallback(async () => {
    // Invalidate any in-flight connect attempt so a late-resolving probe can't
    // re-enable Miyo right after the user turned it off.
    connectAttemptRef.current += 1;
    updateSetting("enableMiyo", false);
    if (settings.enableSemanticSearchV3) {
      updateSetting("enableSemanticSearchV3", false);
    }
    await refresh(true);
  }, [settings.enableSemanticSearchV3, refresh]);

  // Install / remove the `miyo-search` agent skill (path B) — independent of the
  // Miyo connection (path A) above. We AWAIT the disk op and read its real
  // outcome before persisting the flag: a collision with a user-authored
  // `miyo-search` folder, or a write failure, must leave the toggle off rather
  // than claim success. A generation token drops a superseded flip (rapid
  // on/off, or unmount) so it can't commit stale state or fire a late Notice.
  // Derive the skills folder from the configurable Copilot root rather than the
  // retired `agentMode.skills.folder`, which no longer tracks the root: a
  // non-default root would otherwise install/remove the skill in the wrong
  // directory (and collide with the derived path the background seeder uses).
  const skillsFolder = deriveSkillsFolder(settings);
  const handleToggleSearchSkill = useCallback(
    async (next: boolean) => {
      const attempt = (skillAttemptRef.current += 1);
      // A newer toggle supersedes this one and owns the final state, so a
      // superseded attempt must NOT persist. An unmount is separate: it only
      // stops UI work (Notices / React state) — the completed disk result is
      // still written to the persisted flag so the two can never diverge.
      const superseded = () => skillAttemptRef.current !== attempt;
      const unmounted = () => !mountedRef.current;
      setPendingSkillEnabled(next);
      try {
        // Import the agent-mode barrel lazily: it pulls in Node-only modules and
        // must never be evaluated on mobile (see main.ts). This handler only runs
        // on desktop — the switch is disabled on `Platform.isMobile` — but the
        // dynamic import keeps the barrel out of the mobile-eager settings bundle.
        const { installMiyoSearchSkill, removeMiyoSearchSkill } = await import("@/agentMode");
        // Nothing has touched disk yet, so bailing here can't diverge disk from flag.
        if (superseded() || unmounted()) return;
        if (next) {
          const result = await installMiyoSearchSkill(app, skillsFolder);
          if (superseded()) return;
          if (result === "installed") {
            // Persist regardless of unmount: the files ARE on disk now.
            updateSetting("enableMiyoSearchSkill", true);
            if (!unmounted()) new Notice("Miyo search skill installed");
          } else if (result === "collision") {
            if (!unmounted()) {
              new Notice(
                "A skill named “miyo-search” already exists in your skills folder. Rename or remove it, then try again."
              );
            }
          } else if (!unmounted()) {
            new Notice("Couldn't install the Miyo search skill. Please try again.");
          }
        } else {
          const result = await removeMiyoSearchSkill(app, skillsFolder);
          if (superseded()) return;
          if (result === "failed") {
            // The skill is still on disk — keep the flag on so UI and disk agree,
            // and surface the failure instead of a silent no-op.
            if (!unmounted()) {
              new Notice("Couldn't remove the Miyo search skill. Please try again.");
            }
            return;
          }
          // Removed, or a markerless collision copy the user owns: honor the
          // disable either way (persist regardless of unmount), only flagging the
          // collision so they can clean up.
          updateSetting("enableMiyoSearchSkill", false);
          if (result === "collision" && !unmounted()) {
            new Notice(
              "Disabled. A user-created “miyo-search” skill was left in place — remove it manually if you don't want it."
            );
          }
        }
      } catch {
        if (!superseded() && !unmounted()) {
          new Notice("Couldn't update the Miyo search skill. Please try again.");
        }
      } finally {
        if (!superseded() && !unmounted()) setPendingSkillEnabled(null);
      }
    },
    [app, skillsFolder]
  );

  const commitUrl = useCallback(() => {
    const trimmed = urlDraft.trim();
    if (trimmed === (settings.miyoServerUrl || "")) {
      // URL unchanged on blur — don't persist or re-probe.
      return;
    }
    // The endpoint changed: invalidate any in-flight attempt bound to the old URL
    // so it can't enable Miyo against a stale target.
    connectAttemptRef.current += 1;
    // Persisting the URL invalidates the store's cache (via its settings
    // subscription), so force a fresh probe against the new endpoint.
    updateSetting("miyoServerUrl", trimmed);
    void refresh(true);
  }, [urlDraft, settings.miyoServerUrl, refresh]);

  // `stale` counts as still-connected for the UI gate: it means "was available,
  // snapshot just aged past the TTL", not "confirmed disconnected". The store
  // downgrades available→stale lazily on read (no notification at the 60s mark),
  // so ANY unrelated re-render past the horizon — e.g. toggling Search scope —
  // would otherwise flip the whole tab to "disconnected" until the next probe.
  // Runtime safety is unaffected: capability routing uses
  // `isMiyoAvailableForCapability` (strict `=== "available"`), not this gate.
  const capabilitiesEnabled = status.backend === "available" || status.backend === "stale";
  // "remote" only when the endpoint points off this machine. An empty URL (local
  // discovery) and an explicit localhost/127.0.0.1/[::1] URL are all local, so
  // derive the label from the same `isLocalMiyoUrl` the auto-register path uses
  // rather than "any non-empty URL", which mislabels an explicit localhost.
  const connectedRemote = !isLocalMiyoUrl(getMiyoCustomUrl(settings));

  return (
    <div className="tw-space-y-4">
      <div className="tw-text-sm tw-text-muted">
        Local, private context that stays on your machine — unlimited, no credits.
      </div>

      {(serverScopeStale === true ||
        (serverScopeStale === null && shouldSurfaceMiyoResync(app, settings))) && (
        <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-px-3 tw-py-2.5 tw-text-xs tw-text-warning tw-bg-warning/10 tw-border-warning/30">
          <TriangleAlert className="tw-size-4 tw-shrink-0" />
          <span className="tw-flex-1">
            Miyo&apos;s excluded folders don&apos;t match your Copilot folder — chats could be
            indexed and exposed. Resync to update them.
          </span>
          {canAutoAddVault() ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={resyncPending}
              onClick={() => void handleResync()}
            >
              {resyncPending ? "Resyncing…" : "Resync Miyo"}
            </Button>
          ) : (
            <span className="tw-shrink-0">Remove and re-add this folder in the Miyo app.</span>
          )}
        </div>
      )}

      {/* Connection */}
      <SettingSection label="Connection">
        <CapabilityRow
          title="Miyo"
          description={
            <span>
              Runs locally and connects automatically. Don&apos;t have Miyo yet?{" "}
              <a
                href={MIYO_DOWNLOAD_URL}
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
              onConnect={() => void handleConnect()}
              onDisconnect={() => void handleDisconnect()}
              onRetry={() => void handleRetry()}
            />
          }
        />

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
                description="Leave blank for local discovery, or point at a remote Miyo instance. The Connector above uses this endpoint."
              >
                <Input
                  value={urlDraft}
                  onChange={(event) => setUrlDraft(event.target.value)}
                  onBlur={commitUrl}
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
          credits · <span className="tw-font-semibold tw-text-accent">Miyo</span> = local,
          unlimited, on your machine
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
                    description="Understands meaning, not just keywords — finds related notes on-device."
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
                description="Search your ChatGPT / Claude chats locally. Set up chat sources and indexing in Miyo."
                status={status.chatSync}
                statusText={chatSyncStatusText(status.chatSync)}
                actionLabel="Manage in Miyo"
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
                description="Processes PDF & EPUB locally via Miyo; other formats use Plus cloud."
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
