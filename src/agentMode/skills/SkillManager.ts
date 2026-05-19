import { logError, logInfo, logWarn } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { atom, createStore, useAtomValue } from "jotai";
import { FileSystemAdapter, type App, type EventRef, type TAbstractFile } from "obsidian";
import { agentSkillsDirAbs, DEFAULT_SKILLS_FOLDER } from "./agentPaths";
import { runBulkMove, type BulkMoveResult } from "./bulkMove";
import { discoverManagedSkills, type SkillsFsAdapter } from "./discoverManagedSkills";
import {
  createEmptyImportDetectorResult,
  detectImportCandidates,
  totalCandidates,
  type ImportDetectorResult,
} from "./importDetector";
import {
  createNodeBulkMoveFs,
  createNodeImportDetectorFs,
  createNodeReconcileFs,
} from "./nodeFsAdapters";
import { reconcile, type ReconcileReport } from "./reconcile";
import type { SkillFrontmatterPatch } from "./skillFormat";
import { runDeleteSkill, runToggleAgent } from "./toggleAgent";
import type { BackendId, ImportCandidate, Skill } from "./types";
import { runRenameSkill, runUpdateProperties } from "./updateProperties";

/** Debounce window for vault-watch-driven reconciliation, per spec. */
const RECONCILE_DEBOUNCE_MS = 250;

const skillManagerStore = createStore();
const skillsAtom = atom<Skill[]>([]);
const lastScannedFolderAtom = atom<string>(DEFAULT_SKILLS_FOLDER);
const epermSeenAtom = atom<boolean>(false);

export type SkillOperationFailureCode =
  | "no-vault-path"
  | "unknown-agent"
  | "invalid"
  | "collision"
  | "eperm"
  | "fs-error";

export type SkillOperationResult<
  TCode extends SkillOperationFailureCode = SkillOperationFailureCode,
> = { ok: true } | { ok: false; code: TCode; message: string };

/** Result of a per-agent toggle. */
export type ToggleAgentResult = SkillOperationResult<
  "no-vault-path" | "unknown-agent" | "eperm" | "fs-error"
>;

/** Result of {@link SkillManager.deleteSkill}. */
export type DeleteSkillResult = SkillOperationResult<"no-vault-path" | "fs-error">;

/** Result of {@link SkillManager.updateProperties}. */
export type UpdatePropertiesResult = SkillOperationResult<"fs-error">;

/** Result of {@link SkillManager.renameSkill}. */
export type RenameSkillResult = SkillOperationResult<
  "no-vault-path" | "invalid" | "collision" | "eperm" | "fs-error"
>;

/** Summary of a refresh pass. Reconciliation errors do not make discovery fail. */
export interface RefreshResult {
  ok: boolean;
  folder: string;
  skillCount: number;
  reconcileErrorCount: number;
  discoveryError?: string;
  reconcileError?: string;
}

/** Listener fired when the managed skill set relevant to any backend changes. */
export type SkillSetChangeListener = (backendId: BackendId, signature: string) => void;

/**
 * Orchestrator for canonical-store skill discovery + symlink fanout.
 * Handles per-agent toggle, delete, and reconciliation (forward + reverse).
 *
 * Top-level only: reads `getSettings()` to resolve the configured folder.
 * Inner helpers receive concrete resolved paths and an FS adapter — see
 * AGENTS.md "Avoiding Deep Dependency Chains in Tests".
 */
export class SkillManager {
  private static instance: SkillManager | null = null;
  private inFlight: Promise<RefreshResult> | null = null;
  private inFlightFolder: string | null = null;
  private queuedRefresh = false;

  /** Vault watcher event refs; torn down in {@link dispose}. */
  private vaultEventRefs: EventRef[] = [];
  /** Trailing-edge debounce handle for vault-watch-triggered passes. */
  private reconcileDebounceTimer: number | null = null;
  /** Last published per-backend skill signatures. */
  private readonly skillSetSignatures = new Map<BackendId, string>();
  /** Subscribers interested in backend-visible skill-set changes. */
  private readonly skillSetListeners = new Set<SkillSetChangeListener>();
  /** Pre-normalized agent dir set used by the vault-watcher hot path. */
  private readonly normalizedAgentDirs: ReadonlyArray<string>;

  /** App handle is captured at the plugin edge; inner helpers stay pure. */
  private constructor(
    private readonly app: App,
    private readonly agentDirsProjectRel: Readonly<Record<BackendId, string>>
  ) {
    this.normalizedAgentDirs = Object.values(agentDirsProjectRel).map(normalizeRelPath);
  }

  /**
   * @param agentDirsProjectRel project-relative skills directory for each
   *   registered backend, collected from `BackendDescriptor.skillsProjectDir`.
   */
  static initialize(
    app: App,
    agentDirsProjectRel: Readonly<Record<BackendId, string>>
  ): SkillManager {
    if (SkillManager.instance === null) {
      SkillManager.instance = new SkillManager(app, agentDirsProjectRel);
      SkillManager.instance.subscribeToVaultEvents();
    }
    return SkillManager.instance;
  }

  /**
   * Project-relative skills directory for each registered backend. Exposed
   * for UI components (delete confirm, import consent dialog) and the
   * skill-creation spawn directive.
   */
  getAgentDirsProjectRel(): Readonly<Record<BackendId, string>> {
    return this.agentDirsProjectRel;
  }

  /**
   * Returns the live singleton. Throws if {@link initialize} hasn't run yet —
   * callers that may execute before plugin boot (tests, settings preview)
   * must guard with {@link hasInstance}.
   */
  static getInstance(): SkillManager {
    if (SkillManager.instance === null) {
      throw new Error("SkillManager.getInstance called before initialize");
    }
    return SkillManager.instance;
  }

  /** Whether {@link initialize} has run. Use to gate pre-boot UI surfaces. */
  static hasInstance(): boolean {
    return SkillManager.instance !== null;
  }

  /** Reset the singleton — test-only. */
  static resetForTesting(): void {
    if (SkillManager.instance !== null) {
      SkillManager.instance.dispose();
    }
    SkillManager.instance = null;
    skillManagerStore.set(skillsAtom, []);
    skillManagerStore.set(lastScannedFolderAtom, DEFAULT_SKILLS_FOLDER);
    skillManagerStore.set(epermSeenAtom, false);
  }

  /**
   * Tear down vault watchers + pending timers. Called from `main.ts`
   * `onunload` and from {@link resetForTesting}.
   *
   * Also clears the singleton so a fresh `initialize()` (e.g. after plugin
   * reload in tests, or a hot-reload during dev) actually rewires watchers
   * rather than handing back a dead instance.
   */
  dispose(): void {
    for (const ref of this.vaultEventRefs) {
      this.app.vault.offref(ref);
    }
    this.vaultEventRefs = [];
    if (this.reconcileDebounceTimer !== null) {
      window.clearTimeout(this.reconcileDebounceTimer);
      this.reconcileDebounceTimer = null;
    }
    this.skillSetListeners.clear();
    this.skillSetSignatures.clear();
    this.inFlight = null;
    this.inFlightFolder = null;
    this.queuedRefresh = false;
    if (SkillManager.instance === this) {
      SkillManager.instance = null;
    }
  }

  /**
   * Run discovery + reconciliation against the currently configured folder
   * and publish the results into the store. Same-folder callers coalesce onto
   * the in-flight pass; a folder change queues one follow-up pass so the final
   * published state matches current settings.
   */
  async refresh(): Promise<RefreshResult> {
    const folder = resolveSkillsFolder();
    if (this.inFlight !== null) {
      if (this.inFlightFolder !== folder) {
        this.queuedRefresh = true;
      }
      return this.inFlight;
    }
    this.inFlight = Promise.resolve()
      .then(() => this.runRefreshLoop(folder))
      .finally(() => {
        this.inFlight = null;
        this.inFlightFolder = null;
        this.queuedRefresh = false;
      });
    return this.inFlight;
  }

  /**
   * Subscribe to backend-visible skill-set changes. The listener receives
   * the backend id whose effective managed skill signature changed.
   */
  subscribeToSkillSetChange(listener: SkillSetChangeListener): () => void {
    this.skillSetListeners.add(listener);
    return () => this.skillSetListeners.delete(listener);
  }

  /**
   * Compute a stable signature for the current managed skill set as seen by
   * `backendId`. Includes all managed skills, because OpenCode's config
   * depends on both allowed skills and deny rules for cross-discovered skills.
   */
  computeSkillSetSignature(backendId: BackendId): string {
    return computeSkillSetSignature(getManagedSkills(), backendId);
  }

  /** Run one or more refresh passes until no folder-change pass is queued. */
  private async runRefreshLoop(initialFolder: string): Promise<RefreshResult> {
    let folder = initialFolder;
    let result: RefreshResult;
    do {
      this.queuedRefresh = false;
      this.inFlightFolder = folder;
      result = await this.runOnce(folder);
      if (this.queuedRefresh) {
        folder = resolveSkillsFolder();
      }
    } while (this.queuedRefresh);
    return result;
  }

  /**
   * One pass: discover canonical skills, run reconciliation (forward +
   * reverse) against the per-agent dirs, publish the list. Errors are logged
   * and summarized in the returned result instead of thrown.
   */
  private async runOnce(folder: string): Promise<RefreshResult> {
    const absRoot = resolveAbsolutePath(this.app, folder);
    const adapter = createFsAdapter(this.app);

    try {
      const skills = await discoverManagedSkills({
        skillsFolderRelPath: folder,
        skillsFolderAbsPath: absRoot,
        adapter,
      });

      // Reconcile against the agent dirs if we have an on-disk vault.
      const vaultRoot = resolveVaultRootAbs(this.app);
      let reconcileErrorCount = 0;
      let reconcileError: string | undefined;
      if (vaultRoot !== null && absRoot !== null) {
        try {
          const report = await reconcile({
            skills,
            canonicalAbsRoot: absRoot,
            agentDirsAbs: this.resolveAgentDirsAbs(vaultRoot),
            fs: createNodeReconcileFs(),
          });
          reconcileErrorCount = report.errors.length;
          recordReconcileReport(report);
        } catch (err) {
          reconcileError = err instanceof Error ? err.message : String(err);
          reconcileErrorCount = 1;
          logWarn(`[skills] Reconciliation pass failed: ${reconcileError}`);
        }
      }

      skillManagerStore.set(skillsAtom, skills);
      skillManagerStore.set(lastScannedFolderAtom, folder);
      this.publishSkillSetChanges(skills);
      logInfo(`[skills] Discovered ${skills.length} managed skill(s) under "${folder}"`);
      return {
        ok: true,
        folder,
        skillCount: skills.length,
        reconcileErrorCount,
        ...(reconcileError !== undefined ? { reconcileError } : {}),
      };
    } catch (err) {
      logError("[skills] Discovery pass failed", err);
      return {
        ok: false,
        folder,
        skillCount: 0,
        reconcileErrorCount: 0,
        discoveryError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Toggle a single agent on/off for the given skill. Idempotent:
   *
   * 1. Write the canonical SKILL.md first with the new
   *    `metadata.copilot-enabled-agents` list — frontmatter is the source
   *    of truth, so on-disk state stays consistent even when the symlink
   *    op fails downstream.
   * 2. Create or remove the symlink at `<vault>/.<agent>/skills/<name>`.
   *    On Windows EPERM the frontmatter is **not** rolled back —
   *    reconciliation reattempts the link on every subsequent pass once
   *    the user enables Developer Mode.
   * 3. Refresh the in-memory skill list so the grid reflects the new state.
   */
  async toggleAgent(skill: Skill, agent: BackendId, enabled: boolean): Promise<ToggleAgentResult> {
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return noVaultPathFailure();
    }
    const folder = resolveSkillsFolder();
    if (resolveAbsolutePath(this.app, folder) === null) {
      return noVaultPathFailure();
    }

    const fs = createNodeReconcileFs();
    const agentDir = this.resolveAgentDirAbs(vaultRoot, agent);
    if (agentDir === null) {
      return { ok: false, code: "unknown-agent", message: `Unknown agent: ${agent}` };
    }
    const result = await runToggleAgent({
      skill,
      agent,
      enabled,
      agentDirAbs: agentDir,
      fs,
    });

    if (!result.ok && result.reason === "eperm") {
      skillManagerStore.set(epermSeenAtom, true);
    }

    await this.refresh();
    return result.ok ? { ok: true } : failureFromReason(result.reason);
  }

  /**
   * Delete a managed skill end-to-end: remove every enabled agent's
   * symlink, then remove the canonical directory recursively, then
   * refresh the in-memory list. The action is irreversible — the UI
   * gates this behind a confirmation modal.
   */
  async deleteSkill(skill: Skill): Promise<DeleteSkillResult> {
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return noVaultPathFailure();
    }
    const fs = createNodeReconcileFs();
    const result = await runDeleteSkill({
      skill,
      agentDirsAbs: this.resolveAgentDirsAbs(vaultRoot),
      fs,
    });
    await this.refresh();
    return result.ok ? { ok: true } : fsFailure(result.reason ?? "Unknown filesystem error.");
  }

  /**
   * Rewrite the canonical SKILL.md frontmatter with the given patch. No
   * symlink work is performed — callers that need a rename should call
   * {@link renameSkill} first.
   *
   * Preserves every unknown top-level key and unknown `metadata.*` key
   * byte-for-byte (delegated to `serializeSkillFile`). On success, runs a
   * refresh so the in-memory grid reflects the new state.
   */
  async updateProperties(
    skill: Skill,
    patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">
  ): Promise<UpdatePropertiesResult> {
    const fs = createNodeReconcileFs();
    const result = await runUpdateProperties({ skill, patch, fs });
    if (result.ok) {
      await this.refresh();
    }
    return result.ok ? { ok: true } : fsFailure(result.reason);
  }

  /**
   * Rename a managed skill: dir-rename + per-agent symlink retarget +
   * frontmatter `name:` rewrite. See `runRenameSkill` for the full
   * lifecycle. The canonical rename and symlink retargets are processed
   * even when one agent's link hits EPERM — `metadata.copilot-enabled-agents`
   * remains the source of truth and reconciliation heals the missing link
   * on the next pass once Developer Mode is on.
   */
  async renameSkill(skill: Skill, newName: string): Promise<RenameSkillResult> {
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return noVaultPathFailure();
    }
    const folder = resolveSkillsFolder();
    const canonical = resolveAbsolutePath(this.app, folder);
    if (canonical === null) {
      return noVaultPathFailure();
    }

    const fs = createNodeReconcileFs();
    const result = await runRenameSkill({
      skill,
      newName,
      canonicalAbsRoot: canonical,
      agentDirsAbs: this.resolveAgentDirsAbs(vaultRoot),
      fs,
    });

    if (!result.ok && result.reason === "eperm") {
      skillManagerStore.set(epermSeenAtom, true);
    }

    // Refresh after any mutation beyond validation/collision, so the grid
    // reflects the canonical filesystem even when a late step failed.
    if (result.ok || (!result.ok && result.mutated === true)) {
      await this.refresh();
    }
    if (result.ok) return { ok: true };
    if (result.reason === "invalid") {
      return { ok: false, code: "invalid", message: "Skill name is invalid." };
    }
    if (result.reason === "collision") {
      return { ok: false, code: "collision", message: "A skill with that name already exists." };
    }
    return failureFromReason(result.reason);
  }

  /**
   * Walk every per-agent project path under the vault and return the
   * import candidates grouped by source agent. Returns empty buckets if
   * the host has no `FileSystemAdapter` (mobile / test environments).
   *
   * Candidates whose `sourcePath` appears in
   * `agentMode.skills.importSkipList` are filtered out — those are
   * sources from prior bulk-import attempts that failed to move and that
   * the user has not explicitly asked us to retry. The "Find existing
   * skills" rescan button clears the skip-list to retry them.
   */
  async detectImports(): Promise<ImportDetectorResult> {
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return createEmptyImportDetectorResult(this.agentDirsProjectRel);
    }
    const folder = resolveSkillsFolder();
    const canonical = resolveAbsolutePath(this.app, folder);
    if (canonical === null) {
      return createEmptyImportDetectorResult(this.agentDirsProjectRel);
    }
    try {
      const raw = await detectImportCandidates({
        vaultRootAbsPath: vaultRoot,
        canonicalAbsPath: canonical,
        agentDirsProjectRel: this.agentDirsProjectRel,
        fs: createNodeImportDetectorFs(),
      });
      const skip = new Set(getSettings().agentMode?.skills?.importSkipList ?? []);
      if (skip.size === 0) return raw;
      const filtered = createEmptyImportDetectorResult(this.agentDirsProjectRel);
      for (const [agent, candidates] of Object.entries(raw)) {
        filtered[agent] = candidates.filter((c) => !skip.has(c.sourcePath));
      }
      return filtered;
    } catch (err) {
      logError("[skills] Import detection failed", err);
      return createEmptyImportDetectorResult(this.agentDirsProjectRel);
    }
  }

  /**
   * Run the bulk-move state machine over the supplied candidates. Returns
   * one result row per candidate. After running, triggers a discovery
   * refresh so the canonical grid reflects the newly moved skills.
   *
   * Names already taken in the current canonical grid are passed in so
   * the auto-suffix logic can avoid colliding with them.
   */
  async runImport(candidates: ImportCandidate[]): Promise<BulkMoveResult> {
    const folder = resolveSkillsFolder();
    const canonical = resolveAbsolutePath(this.app, folder);
    if (canonical === null) {
      // No on-disk vault — bail with all rows marked as rolled back.
      return {
        results: candidates.map((c) => ({
          candidate: c,
          targetName: c.name,
          status: "rolledBack",
          reason: "Vault has no on-disk path on this platform.",
        })),
      };
    }
    const preTaken = skillManagerStore.get(skillsAtom).map((s) => s.name);
    const result = await runBulkMove({
      candidates,
      canonicalAbsRoot: canonical,
      preTaken,
      fs: createNodeBulkMoveFs(),
    });
    // Persist source paths that did not land as a managed skill — the
    // detector skips them on subsequent passes so the consent dialog
    // doesn't re-prompt for the same failed sources. The "Find existing
    // skills" rescan button clears this list to retry.
    const failedPaths = result.results
      .filter((row) => row.status !== "moved")
      .map((row) => row.candidate.sourcePath);
    if (failedPaths.length > 0) {
      // Single read so we spread one consistent snapshot, not two.
      const agentMode = getSettings().agentMode;
      const merged = Array.from(
        new Set([...(agentMode?.skills?.importSkipList ?? []), ...failedPaths])
      );
      updateSetting("agentMode", {
        ...agentMode,
        skills: { ...agentMode.skills, importSkipList: merged },
      });
    }
    // refresh() runs reconciliation as part of its pass, so any leftover
    // links from an aborted run get cleaned up here.
    await this.refresh();
    return result;
  }

  /**
   * Clear the import skip-list so the next `detectImports` pass returns
   * every candidate again. Called by the "Find existing skills" button.
   */
  clearImportSkipList(): void {
    const agentMode = getSettings().agentMode;
    if ((agentMode?.skills?.importSkipList ?? []).length === 0) return;
    updateSetting("agentMode", {
      ...agentMode,
      skills: { ...agentMode.skills, importSkipList: [] },
    });
  }

  /**
   * Subscribe to vault file events that touch the canonical skills folder
   * or any registered agent skill directory. Mutations there can
   * desync the symlink fanout — we debounce by 250ms so a bulk rename
   * fires one pass rather than dozens.
   */
  private subscribeToVaultEvents(): void {
    const handler = (file: TAbstractFile): void => {
      if (!this.isWatchedPath(file.path)) return;
      this.scheduleReconcile();
    };

    // Rename includes the previous path; schedule if either side of the move
    // was watched so moves out of a skills folder still reconcile.
    this.vaultEventRefs.push(this.app.vault.on("create", handler));
    this.vaultEventRefs.push(this.app.vault.on("delete", handler));
    this.vaultEventRefs.push(this.app.vault.on("modify", handler));
    this.vaultEventRefs.push(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (this.isWatchedPath(file.path) || this.isWatchedPath(oldPath)) {
          this.scheduleReconcile();
        }
      })
    );
  }

  /** Is this vault-relative path inside one of the watched roots? */
  private isWatchedPath(relPath: string): boolean {
    const path = normalizeRelPath(relPath);
    const folder = normalizeRelPath(resolveSkillsFolder());
    if (path === folder || path.startsWith(`${folder}/`)) return true;
    return this.normalizedAgentDirs.some((root) => path === root || path.startsWith(`${root}/`));
  }

  /** Absolute path for a single agent's skills directory, or null if unknown. */
  private resolveAgentDirAbs(vaultRootAbs: string, agent: BackendId): string | null {
    const rel = this.agentDirsProjectRel[agent];
    if (rel === undefined) return null;
    return agentSkillsDirAbs(vaultRootAbs, rel);
  }

  /** Build the absolute `Record<BackendId, string>` map from the project-rel map. */
  private resolveAgentDirsAbs(vaultRootAbs: string): Record<BackendId, string> {
    const out: Record<BackendId, string> = {};
    for (const [agent, rel] of Object.entries(this.agentDirsProjectRel)) {
      out[agent] = agentSkillsDirAbs(vaultRootAbs, rel);
    }
    return out;
  }

  /** Trailing-edge debounce wrapper around {@link refresh}. */
  private scheduleReconcile(): void {
    if (this.reconcileDebounceTimer !== null) {
      window.clearTimeout(this.reconcileDebounceTimer);
    }
    this.reconcileDebounceTimer = window.setTimeout(() => {
      this.reconcileDebounceTimer = null;
      void this.refresh();
    }, RECONCILE_DEBOUNCE_MS);
  }

  /** Notify listeners for every backend whose effective skill signature changed. */
  private publishSkillSetChanges(skills: Skill[]): void {
    for (const backendId of Object.keys(this.agentDirsProjectRel)) {
      const signature = computeSkillSetSignature(skills, backendId);
      const prev = this.skillSetSignatures.get(backendId);
      if (prev === signature) continue;
      this.skillSetSignatures.set(backendId, signature);
      if (prev === undefined && signature === EMPTY_SKILL_SET_SIGNATURE) continue;
      logInfo(`[skills] Skill set changed for ${backendId}; signature=${signature}`);
      for (const listener of this.skillSetListeners) {
        try {
          listener(backendId, signature);
        } catch (err) {
          logError(`[skills] Skill-set listener failed for ${backendId}`, err);
        }
      }
    }
  }
}

/** Total candidate count helper — re-exported for UI callers. */
export { totalCandidates };

/**
 * Best-effort absolute path resolution for the vault root. Returns `null`
 * on platforms where the vault has no on-disk `FileSystemAdapter`.
 */
function resolveVaultRootAbs(app: App): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  return adapter.getBasePath().replace(/[/\\]+$/, "");
}

/**
 * Hook: subscribe to the live managed-skills list. Re-renders the caller
 * whenever {@link SkillManager.refresh} publishes a new list.
 */
export function useManagedSkills(): Skill[] {
  return useAtomValue(skillsAtom, { store: skillManagerStore });
}

/**
 * Hook: subscribe to the session-local EPERM banner flag. Once any
 * symlink op has tripped EPERM, the banner stays up for the rest of the
 * session unless dismissed via {@link dismissEpermBanner}.
 */
export function useEpermSeen(): boolean {
  return useAtomValue(epermSeenAtom, { store: skillManagerStore });
}

/** Imperative setter — for the banner's dismiss button. */
export function dismissEpermBanner(): void {
  skillManagerStore.set(epermSeenAtom, false);
}

/** Synchronous getter — useful from non-React code (e.g. spawn descriptors). */
export function getManagedSkills(): Skill[] {
  return skillManagerStore.get(skillsAtom);
}

const EMPTY_SKILL_SET_SIGNATURE = "skills:v1:0";

/** Compute a deterministic signature for a backend's managed-skill view. */
export function computeSkillSetSignature(skills: readonly Skill[], backendId: BackendId): string {
  if (skills.length === 0) return EMPTY_SKILL_SET_SIGNATURE;
  const rows = skills
    .map((skill) => {
      const enabled = skill.enabledAgents.includes(backendId) ? "1" : "0";
      return [
        skill.name,
        enabled,
        skill.description,
        skill.allowedTools ?? "",
        skill.model ?? "",
        String(skill.disableModelInvocation ?? false),
        String(skill.userInvocable ?? true),
        stableHash(skill.body),
      ].join("\u001f");
    })
    .sort();
  return `skills:v1:${stableHash(rows.join("\u001e"))}`;
}

/** Small deterministic hash used only for change detection signatures. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Resolve `agentMode.skills.folder` defensively. Settings validation
 * normally guarantees a well-formed value, but the UI may render before
 * settings hydration finishes; fall back to the default in that window.
 */
function resolveSkillsFolder(): string {
  const raw = getSettings().agentMode?.skills?.folder;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_SKILLS_FOLDER;
  }
  return raw;
}

/**
 * Best-effort absolute path resolution. Returns `null` on platforms where
 * the vault has no on-disk `FileSystemAdapter` (mobile, in-memory tests).
 * Discovery still works against vault-relative paths in that case.
 */
function resolveAbsolutePath(app: App, relFolder: string): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const base = adapter.getBasePath().replace(/[/\\]+$/, "");
  return `${base}/${relFolder}`;
}

/** Normalize vault-relative watched paths before prefix comparison. */
function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Wrap Obsidian's `Vault.adapter` in the smaller {@link SkillsFsAdapter}
 * surface. Keeps the discovery walker free of Obsidian-specific imports.
 */
function createFsAdapter(app: App): SkillsFsAdapter {
  const adapter = app.vault.adapter;
  return {
    exists: (rel) => adapter.exists(rel),
    list: (rel) => adapter.list(rel),
    read: (rel) => adapter.read(rel),
  };
}

/** Standard failure for desktop-only filesystem operations on unsupported vaults. */
function noVaultPathFailure(): { ok: false; code: "no-vault-path"; message: string } {
  return {
    ok: false,
    code: "no-vault-path",
    message: "Vault has no on-disk path on this platform.",
  };
}

/** Wrap an unexpected filesystem failure in the manager's public result shape. */
function fsFailure(message: string): { ok: false; code: "fs-error"; message: string } {
  return { ok: false, code: "fs-error", message };
}

/** Convert helper-layer reason strings into manager-layer failure codes. */
function failureFromReason(reason: string): {
  ok: false;
  code: "eperm" | "fs-error";
  message: string;
} {
  if (reason === "eperm") {
    return { ok: false, code: "eperm", message: "Permission denied while creating a skill link." };
  }
  return fsFailure(reason);
}

/**
 * Update the EPERM-seen flag based on a reconciliation report. We never
 * un-set the flag here — it's session-local and only clears via the
 * banner's dismiss button or {@link dismissEpermBanner}.
 */
function recordReconcileReport(report: ReconcileReport): void {
  if (report.errors.some((e) => e.reason === "eperm")) {
    skillManagerStore.set(epermSeenAtom, true);
  }
}
