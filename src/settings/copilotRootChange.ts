import { logInfo, logWarn } from "@/logger";
import { normalizeRootFolders, setSettings, validateCopilotFolder } from "@/settings/model";
import type { App } from "obsidian";
import { normalizePath } from "obsidian";

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
  const prefix = `${root}/`;
  return app.vault
    .getMarkdownFiles()
    .some((file) => file.path === root || file.path.startsWith(prefix));
}

/**
 * Activate a new Copilot root, persisting the QA protection set and the active
 * root together and then garbage-collecting orphaned index docs.
 *
 * The protection set (legacy root + previous root + full history + new root)
 * and the new `copilotFolder` are written in a single atomic settings update,
 * so a persisted snapshot can never show the new root without a history entry
 * that keeps the previous root excluded from QA — there is no half-committed
 * window to activate a root whose history has not landed. Callers must have
 * already run {@link validateCopilotFolder} and the content check; the guard
 * here is defensive and simply refuses to activate an invalid value.
 *
 * DESIGN NOTE — activation is memory-first, not persist-before-activate.
 * `setSettings` only updates the in-memory atom; the disk write is the
 * fire-and-forget `persistSettings` in the settings subscriber (see `main.ts`).
 * (a) The residual risk: if that persist fails AND the user creates new
 *     conversations under the new root during this same session AND then
 *     restarts, the reloaded snapshot still carries the old root/history, so the
 *     leftover new-root content is no longer system-excluded and can leak into
 *     QA search.
 * (b) We deliberately do NOT `await persistSettings` before activating (no GC /
 *     no "success" until disk lands). The persistence architecture is locked to
 *     memory-first, no-rollback-on-failure (see the subscriber comment in
 *     `main.ts`): memory is the source of truth and disk reconciles on the next
 *     successful write. An awaited persist here could not roll the in-memory
 *     root back on failure without violating that invariant, so it would only
 *     relabel the same unavoidable window — not close it — while adding a
 *     module-level `suppressNextPersistOnce` race against the subscriber.
 * (c) Existing mitigations bound the damage: the subscriber surfaces a Notice on
 *     persist failure so the user knows the save did not land; the next
 *     successful persist reconciles disk with memory; and `sanitizeSettings`
 *     idempotently unions the current root back into the protection set on every
 *     load, so a persisted (even if lagging) snapshot never activates a root
 *     whose own path is unprotected.
 * (d) If a future review flags this again, point them at this note.
 *
 * DESIGN NOTE — content-check TOCTOU (accepted, not fixed here).
 * The vault-content guard ({@link copilotRootContainsNotes}) runs in the UI
 * before the confirm modal; this Apply layer deliberately does NOT re-run it
 * before `setSettings`.
 * (a) Trigger: within the few-second window between the UI content check passing
 *     and the user confirming, Obsidian Sync or another plugin creates notes
 *     under the target root.
 * (b) Consequence: those newly-arrived notes get excluded from QA wholesale when
 *     the root activates. It is fully reversible — pointing the root elsewhere
 *     restores them; no data is lost.
 * (c) Why not fixed: re-validating at the Apply layer means threading `App` +
 *     `Vault` into this function purely to re-scan for a few-second, reversible
 *     window — a cost that does not match the exposure.
 * (d) If a future review flags this again, point them at this note.
 *
 * @param newRoot - The user-entered root; re-validated defensively.
 */
export async function applyCopilotRootChange(newRoot: string): Promise<void> {
  const validation = validateCopilotFolder(newRoot);
  if (!validation.ok) {
    logWarn("Copilot root change rejected an invalid folder value.", validation.reason);
    return;
  }
  const folder = validation.folder;

  setSettings((current) => ({
    copilotRootHistory: normalizeRootFolders([
      ...current.copilotRootHistory,
      current.copilotFolder,
      folder,
    ]),
    copilotFolder: folder,
  }));

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
