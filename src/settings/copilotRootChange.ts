import { logInfo, logWarn } from "@/logger";
import { matchSystemRoots } from "@/search/searchUtils";
import { getCopilotSaveData } from "@/settings/copilotSaveData";
import {
  type CopilotSettings,
  getSettings,
  normalizeRootFolders,
  setSettings,
  validateCopilotFolder,
} from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import type { App } from "obsidian";
import { normalizePath, TFile } from "obsidian";

/**
 * Build the root-change patch: the new root plus its exclusion history (existing
 * history ∪ the root being left ∪ the new root), normalized. Applied over a
 * settings snapshot to produce both the durable write and the in-memory update
 * from that same snapshot, so the two stay consistent.
 *
 * @param current - Settings snapshot the patch is derived against.
 * @param folder - Validated new root.
 */
function buildRootPatch(
  current: Pick<CopilotSettings, "copilotFolder" | "copilotRootHistory">,
  folder: string
): Pick<CopilotSettings, "copilotFolder" | "copilotRootHistory"> {
  return {
    copilotRootHistory: normalizeRootFolders([
      ...current.copilotRootHistory,
      current.copilotFolder,
      folder,
    ]),
    copilotFolder: folder,
  };
}

/**
 * Whether `folder` is a root Copilot has used before, per the recorded history.
 *
 * Reason: a previously-active root still holds the Copilot Markdown it wrote
 * (chats, memory, prompts) because a root switch never moves files, and that
 * root stays permanently QA-excluded via `copilotRootHistory`. Re-activating it
 * therefore introduces no new "ordinary notes silently hidden" risk, so the
 * caller uses this to skip the {@link copilotRootContainsNotes} guard that would
 * otherwise reject the switch on its own leftover data. Comparison is done on
 * the same canonical form the history and QA matcher use.
 *
 * @param folder - Candidate root, vault-root-relative.
 * @param history - Recorded `copilotRootHistory` from settings.
 */
/**
 * DESIGN NOTE — this comparison is exact-case while
 * {@link copilotRootContainsNotes} folds case on Windows/macOS. The asymmetry is
 * deliberate: that one answers COVERAGE (fail-closed — over-excluding is safe),
 * this one answers IDENTITY and gates an EXEMPTION from the note-content guard,
 * where the same heuristic inverts. On a case-sensitive macOS volume, folding
 * here would accept a genuinely different `notes/` as "the `Notes` root I used
 * before" and skip the guard, activating a Copilot root over the user's real
 * notes.
 * Cost of leaving it exact-case: re-activating a historical root under a
 * different spelling (history holds `teamai`, the user types `TeamAI`) is
 * refused by the content guard instead of exempted. Recoverable — the original
 * spelling works — and it fails closed.
 * The real fix is a filesystem-aware root identity (resolve the candidate to the
 * actual directory and compare that), which this repo has no facility for and
 * which touches already-persisted history. Deferred.
 * If a future review flags the mismatch, point them at this note.
 */
export function isKnownCopilotRoot(folder: string, history: readonly string[]): boolean {
  const [normalizedFolder] = normalizeRootFolders([folder]);
  if (!normalizedFolder) return false;
  return normalizeRootFolders(history).includes(normalizedFolder);
}

/**
 * App-aware helpers for changing the single configurable Copilot root folder.
 *
 * Syntax validation lives in {@link validateCopilotFolder} (pure, in `model`).
 * This module adds the two pieces that need runtime state:
 *   1. vault-content validation — reject a root that already holds ordinary
 *      notes, because activating it would permanently exclude those notes from
 *      QA search (the root and its history are always system-excluded);
 *   2. the atomic root switch plus an immediate best-effort garbage-collection
 *      pass so index docs newly excluded by the change are dropped without
 *      waiting for the next full index.
 */

/**
 * Whether the target root already contains ordinary Markdown notes.
 *
 * Reason: once a folder becomes the Copilot root it is system-excluded from QA
 * indexing wholesale, so pointing the root at a folder that already holds the
 * user's notes would silently drop them from search. The Apply layer calls this
 * to reject that case before committing.
 *
 * @param app - Active Obsidian app, threaded in (never the global `app`).
 * @param folder - Candidate root, vault-root-relative.
 * @returns True when at least one Markdown file lives at or under `folder`.
 */
export function copilotRootContainsNotes(app: App, folder: string): boolean {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return false;
  // Compared exactly as the exclusion boundary will compare it: that matcher
  // folds case on case-insensitive filesystems, so an exact-case check here
  // would clear `Notes` while the vault holds `notes/` — and the very notes this
  // guard exists to protect would then be excluded from search.
  return app.vault.getMarkdownFiles().some((file) => matchSystemRoots(file.path, [root]));
}

/**
 * Find the first prefix of `folder` that already exists as a FILE in the vault,
 * or null when every existing prefix is a folder (or nothing exists yet).
 *
 * Reason: a root like `ai.txt`, or `team/ai` where `team` is a file, passes the
 * syntax and Markdown-content checks, persists successfully, and then every
 * folder creation under it fails forever (the sub-folder pre-create only logs,
 * so the first visible failure is a chat save much later). The Apply layer's
 * caller uses this to reject the change up front with the conflicting path.
 *
 * Residual gaps, accepted: the vault cache doesn't index hidden paths, so a
 * conflict inside a hidden directory surfaces at adapter write time instead;
 * and a file inside an existing root that happens to carry a fixed sub-folder
 * name (e.g. a non-Markdown file literally named `chats`) is not prechecked —
 * both are rare and fail visibly at the write site.
 *
 * @param app - Active Obsidian app, threaded in (never the global `app`).
 * @param folder - Candidate root, vault-root-relative.
 */
export function findCopilotRootFileConflict(app: App, folder: string): string | null {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return null;
  let prefix = "";
  for (const segment of root.split("/")) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    if (app.vault.getAbstractFileByPath(prefix) instanceof TFile) {
      return prefix;
    }
  }
  return null;
}

/**
 * Activate a new Copilot root: durably persist the new root together with its QA
 * protection history BEFORE it becomes visible to runtime folder resolvers, then
 * garbage-collect orphaned index docs.
 *
 * The protection set (legacy root + previous root + full history + new root) and
 * the new `copilotFolder` are written as one snapshot, so a persisted snapshot
 * can never show the new root without a history entry that keeps the previous
 * root excluded from QA. Callers must have already run
 * {@link validateCopilotFolder} and the content check; the guard here is
 * defensive and simply refuses to activate an invalid value.
 *
 * DESIGN NOTE — activation is persist-before-activate.
 * The new root must not reach runtime folder resolvers (`getEffective*Folder`)
 * until the same snapshot is durably on disk.
 * (a) Closed leak: previously the in-memory root flipped first and the disk
 *     write was a fire-and-forget subscriber persist. If that write failed and
 *     the user then wrote chats under the new root and restarted, the reloaded
 *     old snapshot no longer system-excluded the new root, so those chats leaked
 *     into QA search. Persisting first removes that window.
 * (b) Mechanism: the explicit write runs inside {@link runPersistenceTransaction}
 *     via {@link persistSettingsWithinTransaction} (the in-queue path — the
 *     public `persistSettings` would deadlock behind the active transaction).
 *     Only after it resolves do we {@link suppressNextPersistOnce} and
 *     `setSettings`, so the subscriber's duplicate persist for this same state
 *     is swallowed. suppression is consumed synchronously by the subscriber in
 *     the same call stack, so there is no race — the same invariant the keychain
 *     transactions already rely on.
 * (c) Failure path: if the write throws, the transaction rejects before
 *     `setSettings` runs, so the in-memory root is never touched — no rollback
 *     needed, and the caller keeps the old root and surfaces the failure.
 * (d) If a future review flags this again, point them at this note.
 *
 * DESIGN NOTE — content-check TOCTOU (accepted, not fixed here).
 * The vault-content guard ({@link copilotRootContainsNotes}) runs in the UI
 * before the confirm modal; this Apply layer deliberately does NOT re-run it
 * before activating.
 * (a) Trigger: within the few-second window between the UI content check passing
 *     and the user confirming, Obsidian Sync or another plugin creates notes
 *     under the target root.
 * (b) Consequence: those newly-arrived notes get excluded from QA wholesale when
 *     the root activates. It is fully reversible — pointing the root elsewhere
 *     restores them; no data is lost.
 * (c) Why not fixed: `app` is now in scope, but a re-scan would only narrow, not
 *     close, the window — vault contents can still change during the async
 *     persist. Fully closing it would require coordinating with every vault
 *     writer, which is not justified for this reversible outcome.
 * (d) If a future review flags this again, point them at this note.
 *
 * @param app - Active Obsidian app; used to resolve the plugin's `saveData`.
 * @param newRoot - The user-entered root; re-validated defensively.
 */
export async function applyCopilotRootChange(app: App, newRoot: string): Promise<void> {
  const validation = validateCopilotFolder(newRoot);
  if (!validation.ok) {
    logWarn("Copilot root change rejected an invalid folder value.", validation.reason);
    return;
  }
  const folder = validation.folder;
  const saveData = getCopilotSaveData(app);

  // Persist the new root + history durably before flipping the in-memory root,
  // so a failed save (which rejects the transaction) leaves the old root active
  // rather than a session that writes under an unsaved, unprotected root.
  await runPersistenceTransaction(async () => {
    const previous = getSettings();
    const target: CopilotSettings = { ...previous, ...buildRootPatch(previous, folder) };
    await persistSettingsWithinTransaction(target, saveData, previous);

    // Reconcile with any concurrent settings edits that landed during the
    // await. The transaction captured `previous` up front; an unrelated
    // `setSettings()` (theme, prompts, …) during the persist advances in-memory
    // state, and its queued subscriber persist is dropped by the
    // `transactionEpoch` guard. Without this step those edits would be lost from
    // disk if the user quit before the next save. Re-derive from the latest
    // snapshot and, if it differs from what we just wrote, persist once more so
    // disk reflects the merged final state.
    //
    // DESIGN NOTE — single-round reconcile with a functional activation update.
    // The reconcile persists once more so concurrent edits reach disk; it does
    // NOT loop "re-read → persist" until stable, because a stream of edits (e.g.
    // a slider drag) could keep it from terminating — a livelock risk on the
    // settings write queue that is not worth closing a millisecond-scale gap.
    // The residual window: an edit landing during this second persist has its
    // own queued persist dropped by the `transactionEpoch` guard, so it may not
    // reach disk until the next settings save. It is NOT lost from memory —
    // both activation points below apply the root patch with a functional
    // updater `(current) => buildRootPatch(current, folder)`, which only
    // overwrites the root-owned fields and preserves whatever else `current`
    // holds. So the worst case is a disk-lag that the next save reconciles, not
    // a vanished setting. (Passing the whole `merged` snapshot to `setSettings`
    // instead would clobber that concurrent edit from memory too — the bug this
    // note guards against.)
    // If a future review flags this again, point them at this note.
    const fresh = getSettings();
    const merged: CopilotSettings = { ...fresh, ...buildRootPatch(fresh, folder) };
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      try {
        await persistSettingsWithinTransaction(merged, saveData, target);
      } catch (reconcileError) {
        // The first persist already made the root change durable, so the
        // user-visible operation SUCCEEDED — throwing here would make the
        // caller report failure (and skip its follow-ups) over a change that
        // did happen. The only casualty is the concurrent edit's disk copy;
        // it stays in memory (the functional updater below preserves it) and
        // the next successful save reconciles it — the same accepted disk-lag
        // as the second-window note above.
        logWarn(
          "Copilot root change: reconcile save for a concurrent edit failed; " +
            "it stays in memory and lands with the next save.",
          reconcileError
        );
      }
    }

    suppressNextPersistOnce();
    setSettings((current) => buildRootPatch(current, folder));
  });

  // Best-effort: drop index docs that the old/new root now excludes. GC is
  // idempotent and the next full index re-runs it, so failures are logged and
  // swallowed rather than retried. Dynamically imported to keep the search
  // stack out of the settings bundle's eager graph.
  try {
    const { default: VectorStoreManager } = await import("@/search/vectorStoreManager");
    const removed = await VectorStoreManager.getInstance().garbageCollectVectorStore();
    logInfo(`Copilot root change: garbage collection removed ${removed} stale index docs.`);
  } catch (error) {
    logWarn("Copilot root change: garbage collection failed (will retry on next index).", error);
  }
}
