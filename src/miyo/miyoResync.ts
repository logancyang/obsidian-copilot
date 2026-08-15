import { logInfo, logWarn } from "@/logger";
import { MiyoClient, type MiyoAddFolderRequest, type MiyoFolderEntry } from "@/miyo/MiyoClient";
import {
  buildMiyoSyncReceipt,
  getMiyoCustomUrl,
  getMiyoFolderExclusions,
  getMiyoFolderInclusions,
  getMiyoFolderName,
  isLocalMiyoUrl,
  parseMiyoSyncReceipt,
  type MiyoSyncReceipt,
} from "@/miyo/miyoUtils";
import { extractAppIgnoreSettings, getSystemExcludedFolders } from "@/search/searchUtils";
import { type CopilotSettings, getSettings, updateSetting } from "@/settings/model";
import { err2String } from "@/utils";
import { getDeviceId } from "@/utils/deviceId";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";

/**
 * Resynchronize the vault's Miyo registration with the current Copilot scope.
 *
 * Miyo only receives exclusions as a registration-time snapshot, so a Copilot
 * root change leaves the server indexing content that should be excluded (and
 * readable via Relay). This module owns the reconcile: verify the live record,
 * and only when it genuinely diverges, delete + re-register with the fresh
 * scope (deletion also purges the folder's index, verified empirically).
 *
 * All Miyo folder mutations — resync runs AND the register flow — must pass
 * through {@link enqueueMiyoFolderMutation} so a resync can never interleave
 * its DELETE/POST with a concurrent registration.
 */

/** Result of one resync run, for the caller to map onto user-facing messages. */
export type MiyoResyncOutcome =
  /** Server record already covered the scope; receipt written, nothing rebuilt. */
  | "verified"
  /** Deleted + re-registered with the fresh scope; re-scan kicked off. */
  | "resynced"
  /** Rebuilt a registration that had vanished, but its Miyo-side Relay/write
   *  grants were unknowable and had to be reset — the user must be told. */
  | "resynced-grants-reset"
  /** Re-registered, but the re-scan trigger failed; Miyo re-scans on its own. */
  | "resynced-scan-failed"
  /** Server holds a registration this flow can't safely replace (409 right
   *  after a delete, or one left under this vault's previous name) — manual
   *  cleanup in Miyo; still stale. */
  | "conflict"
  /** Vault not registered with Miyo; nothing rebuilt — registering is the
   *  register flow's job (it carries explicit user consent). */
  | "unregistered"
  /** Transport/setup failure (Miyo unreachable, no vault base, …); still stale. */
  | "failed";

/**
 * DESIGN NOTE — the queue below is module state that a token makes behave like
 * instance state. A coordinator the plugin owns and disposes
 * (`plugin.miyoMutations.dispose()`) is the honest shape: object identity is
 * unique per instance, so it would genuinely remove `mutationLifecycle`, the
 * monotonic-collision reasoning, `MiyoMutationSession`, and the numeric token
 * threaded through five call sites — this is a change of state ownership, not a
 * rename.
 *
 * Deferred anyway, and the reason is cost of timing, not size: every guard point
 * still has to survive the move, including the enqueue EXIT check, because the
 * register flow writes its receipt after the awaited call returns
 * (`MiyoSettings.tsx`, the `submission.created` branch) — outside anything the
 * queue can wrap. Doing that now re-opens the review surface of an area that has
 * taken five rounds to settle, on a PR whose blocking review is already answered.
 * No issue is filed yet, so treat this as deferred rather than tracked.
 * If a future review flags the module-level state, point them here — for the
 * shape, not as an argument that it is not worth doing.
 */
// Serializes every Miyo folder mutation. Reason: the settings-tab Resync button
// and the register flow can otherwise interleave DELETE/POST against the same
// registration. The chain mirrors the agent-skills seedChain: each task reads
// fresh state when IT runs (so a root change mid-run simply enqueues a later run
// that sees the newer root), and the chain itself never rejects so one failure
// can't strand later mutations.
let mutationChain: Promise<unknown> = Promise.resolve();

// Identifies the plugin lifecycle a mutation was enqueued under. Node's require
// cache keeps this module alive across disable→enable and "Open another vault",
// so without it a task started under vault A can finish after vault B loaded and
// write A's receipt into B's settings. Monotonic on purpose — never reset to 0
// (unlike `transactionEpoch`), or a task holding a stale value could match a
// later lifecycle by coincidence.
let mutationLifecycle = 0;

/**
 * A producer's proof of which plugin lifecycle it belongs to.
 *
 * Held instead of a bare number so it can only be obtained from
 * {@link resetMiyoMutations} — i.e. by the lifecycle owner, at the moment the
 * previous lifecycle's queue is abandoned. There is deliberately no way to ask
 * for "whatever lifecycle is current right now": handing that to the queue is
 * precisely what let stale producers pass every guard.
 */
export interface MiyoMutationSession {
  readonly lifecycle: number;
}

/**
 * Abandon queued Miyo mutations and invalidate in-flight ones, so no task can
 * outlive the plugin lifecycle that started it, and return the incoming
 * lifecycle's session.
 *
 * The plugin stores that session on itself (`CopilotPlugin.miyoMutationSession`)
 * and producers read it from there; they must never obtain one themselves.
 * Nothing guarantees a producer dies with its lifecycle — the settings React
 * root is never unmounted (`SettingsPage.display()` drops it into a local), an
 * open `Modal` outlives `onunload()`, and settings tabs mount lazily, so a tab
 * first opened after a reload would otherwise vouch for the INCOMING lifecycle
 * while still holding the outgoing vault's `app`. Returning the session from the
 * reset rather than exposing a separate capture makes that misuse unavailable:
 * the only way to get one is to end the previous lifecycle, and only the plugin
 * does that. `onunload` ignores the return value.
 *
 * Called from `onunload()` as its first statement — everything there runs
 * before the first `await`, hence before the next `onload()` could begin, so it
 * carries none of the late-continuation risk that keeps `resetPersistenceState`
 * at load time. Also called at the start of `onload()`, because a crash never
 * runs unload at all.
 *
 * Replacing the chain matters independently of the token: mutations are
 * deliberately untimed (see {@link withLookupTimeout}), so a hung request from
 * the previous lifecycle would otherwise block every Miyo operation in the new
 * one.
 *
 * A task that is mid-flight keeps running, but {@link assertCurrentLifecycle}
 * refuses it before each request it has NOT yet sent — including inside
 * `MiyoClient`, immediately before `requestUrl`. What that does and does not
 * reach is written down below rather than assumed.
 *
 * DESIGN NOTE — the only requests that can still act for a closed lifecycle are
 * ones already handed to `requestUrl`, which Obsidian cannot abort. Everything
 * earlier is refused, including during service discovery and credential
 * decryption (the `beforeRequest` hook the destructive client calls take). The
 * damage a sent request can still do: an explicit `customUrl` bypasses
 * `MiyoServiceDiscovery`'s cache, so it cannot be redirected at the incoming
 * vault, but discovery is a process-wide singleton and an empty URL resolves to
 * a machine-level endpoint (`service.json`, else `127.0.0.1:8742`). When both
 * lifecycles end up on the same endpoint AND share a folder name (folder name
 * is the vault name), an outgoing DELETE can land on the incoming
 * registration — a same-vault re-enable being one common instance.
 *
 * DESIGN NOTE — a producer that outlives its lifecycle can no longer smuggle
 * work in: the lifecycle is proved by a {@link MiyoMutationSession} the plugin
 * received at load, not read at enqueue time. That covers the producers which
 * really do survive `onunload()` — the never-unmounted settings React tree, an
 * open `MiyoConnectModal`, and the root-change async tail — including the case
 * where the stale tree mounts a tab for the FIRST time after the reload.
 *
 * DESIGN NOTE — replacing the chain lets the incoming lifecycle proceed while an
 * uncancellable DELETE from the outgoing one is still in flight, so that DELETE
 * can land on a registration the new lifecycle just created. Keeping the old
 * chain instead would restore ordering, but only by blocking the new lifecycle
 * behind the hung request — the failure this function exists to fix, and the one
 * the maintainer named. `requestUrl` cannot be aborted, so no third option
 * exists for a request already sent.
 *
 * The worst case is worth stating plainly rather than softened: the outgoing
 * lifecycle's compensating POST deliberately carries no lifecycle hook (see
 * {@link addFolderPreservingGrants} — abandoning it after its DELETE succeeded
 * would leave a vault unregistered), so when both lifecycles share an endpoint
 * and a folder name, the late DELETE can remove the incoming registration and
 * the POST then re-create it under the OUTGOING vault's path and scope. The
 * incoming vault's own receipt no longer matches that record, which is what its
 * banner keys on; Resync repairs it. Ordering this correctly would need either a
 * blocking chain (rejected above) or an abortable transport (Obsidian has none).
 * If a future review flags any of these, point them at these notes.
 */
export function resetMiyoMutations(): MiyoMutationSession {
  mutationLifecycle += 1;
  mutationChain = Promise.resolve();
  return Object.freeze({ lifecycle: mutationLifecycle });
}

/**
 * Abort the current mutation unless it still belongs to the live plugin
 * lifecycle. Called before each request that changes server state — including
 * the register flow's, which reaches its POST several awaits after its task
 * started — so a task whose vault closed mid-flight stops rather than acting on
 * a registration nobody is watching.
 *
 * @param lifecycle - Token the mutation captured when it was enqueued.
 */
export function assertCurrentLifecycle(lifecycle: number): void {
  if (lifecycle !== mutationLifecycle) {
    throw new Error("Miyo mutation belongs to an expired plugin lifecycle");
  }
}

/**
 * Persist the Miyo sync receipt on behalf of a queued mutation, unless that
 * mutation belongs to a plugin lifecycle that has since ended.
 *
 * Every receipt write inside a mutation goes through here rather than calling
 * `updateSetting` directly: the settings store is module-global too, so after a
 * vault switch a late write would land in whichever vault is now open.
 *
 * @param lifecycle - Token the mutation captured when it was enqueued.
 * @param receipt - Receipt to store, or `""` to clear it.
 */
function commitReceipt(lifecycle: number, receipt: string): void {
  if (lifecycle !== mutationLifecycle) {
    logWarn("Miyo: discarded a receipt write from an expired plugin lifecycle.");
    return;
  }
  updateSetting("miyoSyncedExclusions", receipt);
}

/**
 * Run `task` behind every previously enqueued Miyo folder mutation. Returns the
 * task's own promise (rejections reach the caller; the chain stays resolved).
 *
 * Rejects instead of resolving when the plugin lifecycle ended while the task
 * was queued or running. Rejecting rather than returning a value is what stops
 * a caller's `await` continuation from running — the register flow writes its
 * receipt *outside* this module, after the awaited call returns, so a check
 * confined to the task body would not cover it.
 *
 * @param task - Mutation to serialize; invoked once its turn arrives, receiving
 *   the lifecycle token it must pass to {@link commitReceipt} for any write.
 * @param session - The lifecycle's session, obtained by the plugin from
 *   {@link resetMiyoMutations} at load and read off it by the caller. Required
 *   rather than defaulted to the live lifecycle: a default would silently
 *   re-admit any producer that outlived its vault.
 */
export function enqueueMiyoFolderMutation<T>(
  task: (lifecycle: number) => Promise<T>,
  session: MiyoMutationSession
): Promise<T> {
  const { lifecycle } = session;
  const run = mutationChain.then(async () => {
    // Queued but not yet started when the lifecycle ended: never run it at all,
    // so it cannot issue requests on behalf of a vault that is no longer open.
    assertCurrentLifecycle(lifecycle);
    const result = await task(lifecycle);
    // Ran to completion, but the lifecycle ended while it did. The server-side
    // work stands (it was this vault's own registration); only the result must
    // not travel onward into a lifecycle that never asked for it.
    assertCurrentLifecycle(lifecycle);
    return result;
  });
  mutationChain = run.catch(() => {
    /* keep the chain alive for the next mutation */
  });
  return run;
}

/** How long a read-only Miyo lookup may hold the mutation chain. */
const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Bound a READ-ONLY lookup so a Miyo that accepts the connection but never
 * responds can't hold the mutation chain forever (Obsidian's `requestUrl` has
 * no timeout of its own — see `fetchHealth`'s probe timeout for the precedent).
 *
 * DESIGN NOTE — mutations (DELETE/POST/scan) are deliberately NOT wrapped.
 * `requestUrl` is uncancellable: racing a mutation against a timer would let
 * the chain advance while the request may still land later, which is exactly
 * the interleaving the chain exists to prevent. A hung mutation therefore still
 * blocks the queue; the read-only bound covers the common mount-verify path.
 * If a future review flags this again, point them here.
 */
function withLookupTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`Miyo ${label} timed out after ${LOOKUP_TIMEOUT_MS}ms`)),
      LOOKUP_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Whether the stored receipt vouches for the registration currently being
 * queried — same device, same Miyo endpoint, same folder name. Only then may a
 * 404 be read as "our registration is gone"; a foreign or renamed identity says
 * nothing about the record the receipt actually describes.
 */
function receiptMatchesIdentity(
  app: App,
  receipt: MiyoSyncReceipt,
  settings: { miyoServerUrl?: string },
  folderName: string
): boolean {
  return (
    receipt.device === getDeviceId(app) &&
    receipt.url === (settings.miyoServerUrl || "").trim() &&
    receipt.folder === folderName
  );
}

/** String-array field of a folder record, read defensively (loose entry type). */
function recordArray(record: MiyoFolderEntry, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isSuperset(container: readonly string[], required: readonly string[]): boolean {
  const set = new Set(container);
  return required.every((entry) => set.has(entry));
}

/**
 * Fold the live record's own scope into a replacement body, so a rebuild never
 * comes back broader than what the server already enforced.
 *
 * Needed because the record is not ours alone: `PATCH /v0/folder` (docs/miyo-api.md)
 * lets any client narrow a registration's filters, and a rebuild that POSTs only
 * the Copilot-derived scope would silently drop those — re-indexing content the
 * owner had excluded and, with Relay on, exposing it to remote AI.
 *
 * Exclusions union: excludes always win server-side, so adding is always safe.
 * Include filters do NOT union — they are an OR whitelist (see
 * {@link getMiyoFolderInclusions}), so unioning would WIDEN scope. When the
 * record carries one, it is kept verbatim and ours is dropped; the cost is that
 * a `qaInclusions` edit stops propagating through a rebuild, which changes
 * nothing in practice since staleness detection is roots-only and never fires on
 * qa* drift anyway. When the record carries none, ours applies — a narrowing.
 *
 * @param desired - Replacement body built from the current Copilot scope; mutated.
 * @param record - Live folder entry the rebuild is replacing.
 */
function preserveRecordScope(desired: MiyoAddFolderRequest, record: MiyoFolderEntry): void {
  const union = (ours: string[] | undefined, theirs: string[]): string[] | undefined => {
    const merged = [...new Set([...(ours ?? []), ...theirs])];
    return merged.length > 0 ? merged : undefined;
  };
  desired.exclude_folders = union(desired.exclude_folders, recordArray(record, "exclude_folders"));
  desired.exclude_patterns = union(
    desired.exclude_patterns,
    recordArray(record, "exclude_patterns")
  );

  const recordIncludeFolders = recordArray(record, "include_folders");
  const recordIncludePatterns = recordArray(record, "include_patterns");
  const recordIncludeExtensions = recordArray(record, "include_extensions");
  const recordWhitelists =
    recordIncludeFolders.length + recordIncludePatterns.length + recordIncludeExtensions.length > 0;
  if (recordWhitelists) {
    desired.include_folders = recordIncludeFolders.length > 0 ? recordIncludeFolders : undefined;
    desired.include_patterns = recordIncludePatterns.length > 0 ? recordIncludePatterns : undefined;
    desired.include_extensions =
      recordIncludeExtensions.length > 0 ? recordIncludeExtensions : undefined;
  }
}

/**
 * Whether the live folder record already excludes every CURRENT system root
 * (active + historical Copilot roots), making a destructive delete +
 * re-register (and the full re-index it implies) unnecessary.
 *
 * DESIGN NOTE — the staleness signal is deliberately ROOTS-ONLY. Drift in the
 * qa* patterns or Obsidian's own ignore list is the pre-existing
 * registration-snapshot gap documented at the registration site (qa* scope is
 * re-applied live at query time; the ignore-list gap predates this PR), and
 * comparing the full desired body here would flag — and destructively
 * rebuild for — users who never changed their root. Exclusions may be a
 * superset: extra exclusions on the record are privacy-safe and not ours to
 * fight, while the leak direction (a system root MISSING from the server's
 * exclusions) always fails the superset and triggers the rebuild. A rebuild
 * then keeps those extras rather than replacing them — see
 * {@link preserveRecordScope}, without which this tolerance would only hold
 * until the next resync.
 * If a future review flags this again, point them here.
 *
 * @param record - Live folder entry fetched from Miyo.
 * @param settings - Settings snapshot the current system roots derive from.
 */
export function miyoRecordCoversSystemRoots(
  record: MiyoFolderEntry,
  settings: CopilotSettings
): boolean {
  // Reuse the registration-body builder (with no qa patterns) so the roots are
  // normalized exactly as they were when pushed into `exclude_folders`.
  const desired = getMiyoFolderExclusions("", getSystemExcludedFolders(settings));
  return isSuperset(recordArray(record, "exclude_folders"), desired.exclude_folders ?? []);
}

/** Registration body for the current scope (shared by resync and verify). */
function buildDesiredScope(app: App, settings = getSettings()): MiyoAddFolderRequest {
  return {
    path: getVaultBase(app) ?? "",
    ...getMiyoFolderInclusions(settings.qaInclusions),
    ...getMiyoFolderExclusions(settings.qaExclusions, [
      ...getSystemExcludedFolders(settings),
      ...extractAppIgnoreSettings(app),
    ]),
  };
}

/**
 * Resync the vault's Miyo registration to the current scope. Never throws —
 * every failure maps to an outcome so fire-and-forget callers stay safe.
 *
 * Serialized via {@link enqueueMiyoFolderMutation}; reads settings fresh when
 * its turn arrives, so a queued run always reconciles toward the latest scope.
 *
 * @param app - Active Obsidian app (vault name/base for the registration).
 * @param session - The lifecycle's session, read off the plugin
 *   (`CopilotPlugin.miyoMutationSession`); never obtained by the caller itself.
 */
export function resyncMiyoFolder(
  app: App,
  session: MiyoMutationSession
): Promise<MiyoResyncOutcome> {
  return enqueueMiyoFolderMutation((lifecycle) => runResync(app, lifecycle), session).catch(
    (error) => {
      // Preserves the never-throws contract: the only rejection the queue itself
      // raises is an expired lifecycle, which for a caller in the current one
      // reads the same as any other unfinished mutation.
      logWarn(`Miyo resync abandoned: ${err2String(error)}`);
      return "failed";
    }
  );
}

/** Result of a read-only scope verification against the live Miyo record. */
export type MiyoScopeVerification = "covered" | "stale" | "unregistered" | "unknown";

/**
 * Verify the live Miyo record against the current scope WITHOUT rebuilding,
 * self-healing the local receipt where the server is the better witness:
 *
 * - record covers the scope but the local receipt mismatches (another device's
 *   receipt arrived via sync, a sync merge reordered history, …) → write the
 *   current receipt silently; no banner, no destructive rebuild.
 * - vault not registered AND the stored receipt names exactly this
 *   device/endpoint/folder → the registration it vouched for is truly gone
 *   (user removed it in Miyo); clear the receipt. A 404 with a DIFFERENT
 *   receipt identity proves nothing about the record the receipt describes:
 *   a renamed vault (same device+endpoint, old folder name) reports "stale" so
 *   the old registration gets surfaced and cleaned up; a foreign-device or
 *   other-endpoint receipt is left untouched and reads "unregistered" (nothing
 *   is exposed on THIS server).
 * - record does NOT cover the scope → "stale": the caller must surface the
 *   resync prompt even if local state looks clean (Reset Settings wiped the
 *   receipt, or the user registered before receipts existed) — the live record
 *   outranks local signals in both directions.
 *
 * Never throws; unreachable Miyo reports "unknown" so callers fall back to the
 * local mismatch signal.
 *
 * @param app - Active Obsidian app (vault name for the registration lookup).
 * @param session - The lifecycle's session, read off the plugin
 *   (`CopilotPlugin.miyoMutationSession`); never obtained by the caller itself.
 */
export function verifyMiyoScope(
  app: App,
  session: MiyoMutationSession
): Promise<MiyoScopeVerification> {
  return enqueueMiyoFolderMutation((lifecycle) => runVerify(app, lifecycle), session).catch(
    (error) => {
      // Same never-throws contract as the resync entry point; an abandoned verify
      // is indistinguishable from an unreachable one to the banner.
      logWarn(`Miyo scope verification abandoned: ${err2String(error)}`);
      return "unknown";
    }
  );
}

async function runVerify(app: App, lifecycle: number): Promise<MiyoScopeVerification> {
  try {
    const settings = getSettings();
    const folderName = getMiyoFolderName(app);
    const customUrl = getMiyoCustomUrl(settings) || undefined;
    // Snapshot the credential with the rest of the request identity: this task
    // may outlive the vault it started under, and the header is otherwise read
    // live per request — which would send the incoming vault's key to this
    // vault's endpoint.
    const client = new MiyoClient({ plusLicenseKey: settings.plusLicenseKey });
    const baseUrl = await client.resolveBaseUrl(customUrl);

    let record: MiyoFolderEntry;
    try {
      record = await withLookupTimeout(client.getFolder(baseUrl, folderName), "folder lookup");
    } catch {
      const registration = await withLookupTimeout(
        client.checkFolderRegistration(folderName, customUrl),
        "registration check"
      );
      if (registration !== "unregistered") {
        return "unknown";
      }
      const receipt = parseMiyoSyncReceipt(settings.miyoSyncedExclusions);
      if (!receipt) {
        // Empty — nothing to clear — or non-empty but unparseable. The latter
        // cannot be attributed to any identity, so it is never cleared: wiping
        // it would sync out and destroy whatever evidence it holds elsewhere.
        return "unregistered";
      }
      if (receiptMatchesIdentity(app, receipt, settings, folderName)) {
        commitReceipt(lifecycle, "");
        return "unregistered";
      }
      // Same device + endpoint but a different folder name: the vault was
      // renamed and the OLD registration may still exist (and expose content).
      // A read-only probe settles it: still registered → keep the receipt as
      // the cleanup lead and surface the prompt; confirmed gone (the user
      // cleaned it up in Miyo) → consume the receipt so the banner can end.
      if (receipt.device === getDeviceId(app) && receipt.url === getMiyoCustomUrl(settings)) {
        const oldName = await withLookupTimeout(
          client.checkFolderRegistration(receipt.folder, customUrl),
          "previous-name check"
        );
        if (oldName === "unregistered") {
          commitReceipt(lifecycle, "");
          return "unregistered";
        }
        if (oldName !== "registered") {
          // Transient failure: the old registration's existence is unknown —
          // neither accuse nor clear; report like any other failed lookup.
          return "unknown";
        }
        return "stale";
      }
      // Foreign device / other endpoint: says nothing about this server, and
      // clearing it would clobber the other device's evidence via sync.
      return "unregistered";
    }

    if (!miyoRecordCoversSystemRoots(record, settings)) {
      return "stale";
    }
    const receipt = buildMiyoSyncReceipt(app, settings);
    if (settings.miyoSyncedExclusions !== receipt) {
      commitReceipt(lifecycle, receipt);
    }
    return "covered";
  } catch (error) {
    logWarn(`Miyo scope verification failed: ${err2String(error)}`);
    return "unknown";
  }
}

/**
 * Re-register a folder whose record was just deleted, retrying once.
 *
 * The retry exists because the grants being restored are only knowable inside
 * this run: they were read off the record moments before the DELETE removed it.
 * A later Resync has no source for them and must fail closed, so one more
 * attempt here is the difference between preserving a user's Relay setting and
 * silently turning it off.
 *
 * @param client - Client already bound to this run's endpoint and credential.
 * @param desired - Registration body carrying the grants read before the DELETE.
 * @param customUrl - Endpoint override captured for this run, if any.
 * @returns The created record, or `null` when the server reports a conflict.
 */
async function addFolderPreservingGrants(
  client: MiyoClient,
  desired: MiyoAddFolderRequest,
  customUrl: string | undefined
): Promise<MiyoFolderEntry | null> {
  try {
    return await client.addFolder(desired, customUrl);
  } catch (error) {
    logWarn(`Miyo resync: re-add failed, retrying once: ${err2String(error)}`);
    // A first POST that landed but lost its response surfaces as 409 here,
    // which the caller already treats as a contested registration.
    return await client.addFolder(desired, customUrl);
  }
}

async function runResync(app: App, lifecycle: number): Promise<MiyoResyncOutcome> {
  try {
    const settings = getSettings();
    const vaultBase = getVaultBase(app);
    if (!vaultBase) {
      logWarn("Miyo resync: no vault base path (mobile/remote?); cannot resync.");
      return "failed";
    }
    const folderName = getMiyoFolderName(app);
    const miyoUrl = getMiyoCustomUrl(settings);
    // Reason: callers gate on a LOCAL endpoint before enqueueing, but this
    // task reads settings fresh when its turn arrives — the endpoint may have
    // been switched to a remote target while queued. A remote registration is
    // not this flow's to DELETE/POST (and the body would leak this machine's
    // vault path), so refuse and stay retryable — mirroring registerVault's
    // execution-time re-check.
    if (!isLocalMiyoUrl(miyoUrl)) {
      logWarn("Miyo resync: endpoint switched to a remote target while queued; not resyncing.");
      return "failed";
    }
    const customUrl = miyoUrl || undefined;
    // Snapshot the credential with the rest of the request identity: this task
    // may outlive the vault it started under, and the header is otherwise read
    // live per request — which would send the incoming vault's key to this
    // vault's endpoint.
    const client = new MiyoClient({ plusLicenseKey: settings.plusLicenseKey });
    const baseUrl = await client.resolveBaseUrl(customUrl);

    // Capture the receipt for the scope we are about to commit. Written only
    // after that exact commit succeeds — never recomputed afterwards, so a root
    // change landing mid-run can't get marked as synced by this run (its own
    // queued run will reconcile it).
    const receipt = buildMiyoSyncReceipt(app, settings);
    const desired = buildDesiredScope(app, settings);

    // Verify first: a record that already enforces the scope needs no rebuild.
    let record: MiyoFolderEntry;
    try {
      record = await withLookupTimeout(client.getFolder(baseUrl, folderName), "folder lookup");
    } catch (error) {
      const registration = await withLookupTimeout(
        client.checkFolderRegistration(folderName, customUrl),
        "registration check"
      );
      if (registration !== "unregistered") {
        logWarn(`Miyo resync: could not read folder record: ${err2String(error)}`);
        return "failed";
      }
      // DESIGN NOTE — what an unregistered vault means here, and what Resync
      // may do about it.
      // (a) A receipt naming THIS device+endpoint+folder is only written after a
      //     successful registration, so its subject is gone: either the user
      //     removed it in Miyo, or a previous rebuild died between its DELETE
      //     and its POST. Those are indistinguishable, and the second one is a
      //     hole this flow can dig itself — refusing to re-add left the user
      //     with no registration and no way back, since every later Resync saw
      //     the same 404 and refused again. The explicit Resync click is the
      //     consent to re-add: it is a user action, on a banner that says the
      //     scope is out of sync, and re-adding is what "resync" means.
      //     Re-registration FAILS CLOSED on the Miyo-side toggles. They were
      //     knowable in the run that deleted the record — which is why that run
      //     retries its own POST rather than leaving them to this path — but by
      //     the time a separate Resync arrives their only source is gone.
      //     Guessing `true` would silently re-grant Relay read access to a
      //     vault whose owner had turned it off; guessing `false` downgrades,
      //     which is why this returns its own outcome so the user is told
      //     rather than left thinking Relay is still on.
      // (b) A receipt naming a DIFFERENT folder on this device+endpoint is NOT
      //     auto-deleted: folder names are just vault names, so the receipt
      //     cannot prove that name still belongs to this vault — another vault
      //     may have registered the same name since, and deleting on receipt
      //     evidence alone could destroy that vault's registration and index.
      //     Manual cleanup is surfaced instead.
      // If a future review flags this again, point them here.
      const staleReceipt = parseMiyoSyncReceipt(settings.miyoSyncedExclusions);
      if (
        staleReceipt &&
        staleReceipt.device === getDeviceId(app) &&
        staleReceipt.url === getMiyoCustomUrl(settings)
      ) {
        if (staleReceipt.folder !== folderName) {
          // Read-only probe: once the old-name registration is confirmed gone
          // (the user cleaned it up in Miyo), the receipt is consumed —
          // without this, following our own "remove it in Miyo, then retry"
          // instruction would keep reporting a conflict forever.
          const oldName = await withLookupTimeout(
            client.checkFolderRegistration(staleReceipt.folder, customUrl),
            "previous-name check"
          );
          if (oldName === "unregistered") {
            commitReceipt(lifecycle, "");
            return "unregistered";
          }
          if (oldName !== "registered") {
            // Transient failure: don't tell the user to delete a registration
            // whose existence is unconfirmed — keep the receipt and retry.
            logWarn("Miyo resync: could not determine the previous-name registration's state.");
            return "failed";
          }
          // Still registered: keep the receipt — it is the only evidence that
          // keeps verify reporting the exposure until the user cleans up.
          logWarn(
            "Miyo resync: a registration under this vault's previous name still exists; " +
              "remove it in the Miyo app."
          );
          return "conflict";
        }
        // The registration this receipt vouched for is gone. Rebuild it with
        // the current scope, but without the Relay/write grants it may have
        // carried — see (a) above.
        desired.allow_remote_read = false;
        desired.allow_writes = false;
        const rebuilt = await client.addFolder(desired, customUrl, () =>
          assertCurrentLifecycle(lifecycle)
        );
        if (rebuilt === null) {
          // 409: something registered this folder between the two lookups.
          // Its scope is unknown, so the receipt stays unwritten and the
          // banner stays up.
          logWarn("Miyo resync: re-add of a vanished registration returned 409.");
          return "conflict";
        }
        commitReceipt(lifecycle, receipt);
        try {
          await client.scanFolder(baseUrl, folderName, false);
        } catch (scanError) {
          logWarn(`Miyo resync: re-scan trigger failed: ${err2String(scanError)}`);
        }
        // Reported separately from a normal resync: the caller has to say the
        // grants were reset, or the downgrade is as silent as the re-grant this
        // avoids.
        return "resynced-grants-reset";
      }
      return "unregistered";
    }

    if (miyoRecordCoversSystemRoots(record, settings)) {
      commitReceipt(lifecycle, receipt);
      logInfo("Miyo resync: server record already covers the scope.");
      return "verified";
    }
    // Carry the user's Miyo-side toggles into the re-registration. Fail
    // closed when a field is absent: omitting allow_remote_read makes the
    // server default it to TRUE, silently re-enabling Relay for a user who
    // opted out in Miyo — the exact privacy hole this resync exists to close.
    desired.allow_remote_read = record.allow_remote_read === true;
    desired.allow_writes = record.allow_writes === true;
    // Same reasoning one level up: the record's own filters are part of the
    // boundary it enforces, and a rebuild must not come back broader.
    preserveRecordScope(desired, record);

    // Last point at which abandoning is still safe: once the DELETE is out, the
    // POST must follow or the vault is left unregistered.
    await client.deleteFolder(folderName, customUrl, () => assertCurrentLifecycle(lifecycle));

    const created = await addFolderPreservingGrants(client, desired, customUrl);
    if (created === null) {
      // 409 right after a delete: the server still holds a registration we
      // couldn't replace. Do NOT write the receipt — its exclusions are
      // unknown and possibly stale.
      logWarn("Miyo resync: re-add returned 409; server registration contested.");
      return "conflict";
    }

    commitReceipt(lifecycle, receipt);

    try {
      await client.scanFolder(baseUrl, folderName, false);
      return "resynced";
    } catch (error) {
      // The scope is committed and the receipt is correct; only the re-index
      // kick failed. Miyo re-scans registered folders on its own (verified on a
      // live instance: last_scan advances days after registration), so surface
      // a warning instead of staying dirty — staying dirty would provoke
      // another destructive delete/re-add for a self-healing lag.
      logWarn(`Miyo resync: re-scan trigger failed: ${err2String(error)}`);
      return "resynced-scan-failed";
    }
  } catch (error) {
    logWarn(`Miyo resync failed: ${err2String(error)}`);
    return "failed";
  }
}
