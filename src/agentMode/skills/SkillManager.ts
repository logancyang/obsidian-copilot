import type { BuiltinPreferences } from "./builtin/reconcileBuiltinSkills";
import { ALL_MANAGED_SKILLS, isBuiltinSkillEnabledFor } from "@/builtinSkills/builtinSkills";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { getEffectiveSkillsFolder } from "@/settings/copilotFolder";
import { publishSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { atom, createStore, useAtomValue } from "jotai";
import { FileSystemAdapter, type App, type EventRef, type TAbstractFile } from "obsidian";
import { normalizeAbsPath, parentDir } from "@/utils/pathUtils";
import { agentSkillsDirAbs, DEFAULT_SKILLS_FOLDER } from "./agentPaths";
import { discoverManagedSkills, type SkillsFsAdapter } from "./discoverManagedSkills";
import { discoverProjectSkills, type ProjectSkillCandidate } from "./discoverProjectSkills";
import { compareSkills, mergeDiscovery } from "./mergeDiscovery";
import {
  duplicateSourceDirsFor,
  migrateProjectSkill,
  type MigrateSkillResult,
} from "./migrateProjectSkill";
import { suffixOnCollision } from "./suffixOnCollision";
import {
  createNodeMigrateSkillFs,
  createNodeProjectDiscoveryFs,
  createNodeReconcileFs,
} from "./nodeFsAdapters";
import { reconcile, type ReconcileReport } from "./reconcile";
import type { SkillFrontmatterPatch } from "./skillFormat";
import { removeAgentLinksPointingTo } from "./symlinks";
import { runDeleteSkill, runToggleAgent } from "./toggleAgent";
import type { BackendId, RejectedSkill, Skill } from "./types";
import { runRenameSkill, runUpdateProperties } from "./updateProperties";
import {
  buildDeleteExpectations,
  buildReconcileExpectations,
  buildRenameExpectations,
  buildToggleExpectations,
  buildUpdatePropertiesExpectations,
  matchExpectation,
  type Expectation,
} from "./vaultEventExpectations";

export interface BuiltinSkillRuntime {
  prepare(folder: string): Promise<void>;
  availableAgents(): readonly string[];
  savePreferences(
    update: (current: BuiltinPreferences) => BuiltinPreferences
  ): Promise<BuiltinPreferences>;
}

const RECONCILE_DEBOUNCE_MS = 250;
const EXPECTATION_TIMEOUT_MS = 10_000;

const skillManagerStore = createStore();
const skillsAtom = atom<Skill[]>([]);
const EMPTY_REJECTED_SKILLS = Object.freeze([]) as unknown as RejectedSkill[];
const rejectedSkillsAtom = atom<RejectedSkill[]>(EMPTY_REJECTED_SKILLS);
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

export type ToggleAgentResult = SkillOperationResult<
  "no-vault-path" | "unknown-agent" | "eperm" | "fs-error"
>;

export type DeleteSkillResult = SkillOperationResult<"no-vault-path" | "fs-error">;

export type UpdatePropertiesResult = SkillOperationResult<"fs-error">;

export type RenameSkillResult = SkillOperationResult<
  "no-vault-path" | "invalid" | "collision" | "eperm" | "fs-error"
>;

export type SavePropertiesResult = SkillOperationResult<
  "no-vault-path" | "invalid" | "collision" | "eperm" | "fs-error"
>;

export interface RefreshResult {
  ok: boolean;
  folder: string;
  skillCount: number;
  reconcileErrorCount: number;
  discoveryError?: string;
  reconcileError?: string;
}

export type SkillSetChangeListener = (backendId: BackendId, signature: string) => void;

export class SkillManager {
  private static instance: SkillManager | null = null;
  private inFlight: Promise<RefreshResult> | null = null;
  private inFlightFolder: string | null = null;
  private queuedRefresh = false;

  private vaultEventRefs: EventRef[] = [];
  private reconcileDebounceTimer: number | null = null;
  private readonly skillSetSignatures = new Map<BackendId, string>();
  private readonly skillSetListeners = new Set<SkillSetChangeListener>();
  private readonly normalizedAgentDirs: ReadonlyArray<string>;
  private internalMutationDepth = 0;
  private pendingExpectations: Expectation[] = [];
  private safetyTimer: number | null = null;

  private constructor(
    private readonly app: App,
    private readonly agentDirsProjectRel: Readonly<Record<BackendId, string>>,
    private readonly builtinRuntime?: BuiltinSkillRuntime
  ) {
    this.normalizedAgentDirs = Object.values(agentDirsProjectRel).map(normalizeRelPath);
  }

  static initialize(
    app: App,
    agentDirsProjectRel: Readonly<Record<BackendId, string>>,
    builtinRuntime?: BuiltinSkillRuntime
  ): SkillManager {
    if (SkillManager.instance === null) {
      SkillManager.instance = new SkillManager(app, agentDirsProjectRel, builtinRuntime);
      SkillManager.instance.subscribeToVaultEvents();
    }
    return SkillManager.instance;
  }

  getAgentDirsProjectRel(): Readonly<Record<BackendId, string>> {
    return this.agentDirsProjectRel;
  }

  static getInstance(): SkillManager {
    if (SkillManager.instance === null) {
      throw new Error("SkillManager.getInstance called before initialize");
    }
    return SkillManager.instance;
  }

  static hasInstance(): boolean {
    return SkillManager.instance !== null;
  }

  static resetForTesting(): void {
    if (SkillManager.instance !== null) {
      SkillManager.instance.dispose();
    }
    SkillManager.instance = null;
    skillManagerStore.set(skillsAtom, []);
    skillManagerStore.set(rejectedSkillsAtom, EMPTY_REJECTED_SKILLS);
    publishSkillLoadErrorCount(0);
    skillManagerStore.set(lastScannedFolderAtom, DEFAULT_SKILLS_FOLDER);
    skillManagerStore.set(epermSeenAtom, false);
  }

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
    this.internalMutationDepth = 0;
    this.pendingExpectations = [];
    this.clearSafetyTimer();
    // The host-side error count outlives this manager across a hot reload. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
    publishSkillLoadErrorCount(0);
    if (SkillManager.instance === this) {
      SkillManager.instance = null;
    }
  }

  async refresh(force = false): Promise<RefreshResult> {
    const folder = resolveSkillsFolder();
    if (this.inFlight !== null) {
      if (force || this.inFlightFolder !== folder) {
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

  subscribeToSkillSetChange(listener: SkillSetChangeListener): () => void {
    this.skillSetListeners.add(listener);
    return () => this.skillSetListeners.delete(listener);
  }

  computeSkillSetSignature(backendId: BackendId): string {
    return computeSkillSetSignature(getManagedSkills(), backendId);
  }

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

  private async runOnce(folder: string): Promise<RefreshResult> {
    const absRoot = resolveAbsolutePath(this.app, folder);
    const adapter = createFsAdapter(this.app);
    const vaultRoot = resolveVaultRootAbs(this.app);

    try {
      // Bundled files must settle before link fanout. https://github.com/logancyang/obsidian-copilot/issues/3022
      let builtinError: string | undefined;
      try {
        if (this.builtinRuntime)
          await this.runInternalMutation(() => this.builtinRuntime!.prepare(folder));
      } catch (error) {
        builtinError = error instanceof Error ? error.message : String(error);
      }
      const canonicalDiscovery = await discoverManagedSkills({
        skillsFolderRelPath: folder,
        skillsFolderAbsPath: absRoot,
        adapter,
      });

      let projectCandidates: ProjectSkillCandidate[] = [];
      let rejectedProjectSkills: RejectedSkill[] = [];
      if (vaultRoot !== null) {
        try {
          const projectDiscovery = await discoverProjectSkills({
            vaultRootAbsPath: vaultRoot,
            agentDirsProjectRel: this.agentDirsProjectRel,
            fs: createNodeProjectDiscoveryFs(),
          });
          projectCandidates = projectDiscovery.accepted;
          rejectedProjectSkills = projectDiscovery.rejected;
        } catch (err) {
          logWarn(
            `[skills] Project-skill walk failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      const settings = getSettings();
      const availableAgents = this.builtinRuntime?.availableAgents();
      const skills = mergeDiscovery(canonicalDiscovery.accepted, projectCandidates).map((skill) => {
        // Failed cleanup must not reactivate an opted-out skill through stale metadata. https://github.com/logancyang/obsidian-copilot/issues/3022
        if (!skill.builtin || !availableAgents) return skill;
        return {
          ...skill,
          enabledAgents: availableAgents.filter((agent) =>
            isBuiltinSkillEnabledFor(settings, skill.name, agent)
          ),
        };
      });
      const rejectedSkills =
        canonicalDiscovery.rejected.length === 0 && rejectedProjectSkills.length === 0
          ? EMPTY_REJECTED_SKILLS
          : canonicalDiscovery.rejected
              .concat(rejectedProjectSkills)
              .sort((a, b) => a.dirPath.localeCompare(b.dirPath));

      let reconcileErrorCount = builtinError ? 1 : 0;
      let reconcileError: string | undefined = builtinError;
      if (vaultRoot !== null && absRoot !== null) {
        try {
          const canonicalForReconcile = skills.filter((s) => s.location.kind === "canonical");
          const report = await this.runInternalMutation(
            () =>
              reconcile({
                skills: canonicalForReconcile,
                canonicalAbsRoot: absRoot,
                agentDirsAbs: this.resolveAgentDirsAbs(vaultRoot),
                fs: createNodeReconcileFs(),
              }),
            (r) => buildReconcileExpectations(r, vaultRoot)
          );
          reconcileErrorCount += report.errors.length;
          recordReconcileReport(report);
        } catch (err) {
          reconcileError = err instanceof Error ? err.message : String(err);
          reconcileErrorCount = 1;
          logWarn(`[skills] Reconciliation pass failed: ${reconcileError}`);
        }
      }

      skillManagerStore.set(skillsAtom, skills);
      skillManagerStore.set(rejectedSkillsAtom, rejectedSkills);
      publishSkillLoadErrorCount(rejectedSkills.length);
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

  async setBuiltinSkillEnabled(
    name: string,
    enabled: boolean
  ): Promise<SkillOperationResult<"fs-error">> {
    return this.updateBuiltinPreference(name, (pref) => ({ ...pref, disabled: !enabled }));
  }

  async setBuiltinAgentEnabled(
    name: string,
    agent: string,
    enabled: boolean
  ): Promise<SkillOperationResult<"fs-error">> {
    return this.updateBuiltinPreference(name, (pref) => ({
      ...pref,
      disabledAgents: computeNextAgents(pref.disabledAgents ?? [], agent, !enabled),
    }));
  }

  private builtinMutation: Promise<unknown> = Promise.resolve();

  private async updateBuiltinPreference(
    name: string,
    update: (pref: BuiltinPreferences[string]) => BuiltinPreferences[string]
  ): Promise<SkillOperationResult<"fs-error">> {
    const operation = this.builtinMutation.then(
      async (): Promise<SkillOperationResult<"fs-error">> => {
        if (!this.builtinRuntime || !ALL_MANAGED_SKILLS.some((skill) => skill.name === name))
          return fsFailure("Unknown built-in skill.");
        try {
          await this.inFlight;
          await this.builtinRuntime.savePreferences((preferences) => ({
            ...preferences,
            [name]: update(preferences[name] ?? {}),
          }));
          // A preference changed mid-discovery still needs a final pass. https://github.com/logancyang/obsidian-copilot/issues/3022
          if (this.inFlight) this.queuedRefresh = true;
          const result = await this.refresh();
          return result.ok && result.reconcileErrorCount === 0
            ? { ok: true }
            : fsFailure(
                result.reconcileError ??
                  result.discoveryError ??
                  "Could not update built-in skill files."
              );
        } catch (error) {
          return fsFailure(error instanceof Error ? error.message : String(error));
        }
      }
    );
    this.builtinMutation = operation;
    return operation;
  }

  async toggleAgent(skill: Skill, agent: BackendId, enabled: boolean): Promise<ToggleAgentResult> {
    if (skill.builtin) return this.setBuiltinAgentEnabled(skill.name, agent, enabled);
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
    const result = await this.runInternalMutation(
      () =>
        runToggleAgent({
          skill,
          agent,
          enabled,
          agentDirAbs: agentDir,
          fs,
        }),
      (r) =>
        r.ok || (!r.ok && r.reason === "eperm")
          ? buildToggleExpectations(skill, enabled, agentDir, vaultRoot)
          : []
    );

    if (!result.ok && result.reason === "eperm") {
      skillManagerStore.set(epermSeenAtom, true);
    }

    if (result.ok || (!result.ok && result.reason === "eperm")) {
      this.replaceManagedSkill(skill, {
        ...skill,
        enabledAgents: computeNextAgents(skill.enabledAgents, agent, enabled),
      });
    }
    return result.ok ? { ok: true } : failureFromReason(result.reason);
  }

  async deleteSkill(skill: Skill): Promise<DeleteSkillResult> {
    if (skill.builtin)
      return fsFailure("Built-in skills cannot be edited or deleted. Disable the skill instead.");
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return noVaultPathFailure();
    }
    const fs = createNodeReconcileFs();
    const agentDirsAbs = this.resolveAgentDirsAbs(vaultRoot);
    const result = await this.runInternalMutation(
      () =>
        runDeleteSkill({
          skill,
          agentDirsAbs,
          fs,
        }),
      (r) => (r.ok ? buildDeleteExpectations(skill, agentDirsAbs, vaultRoot) : [])
    );
    if (result.ok) {
      this.removeManagedSkill(skill);
    }
    return result.ok ? { ok: true } : fsFailure(result.reason ?? "Unknown filesystem error.");
  }

  async updateProperties(
    skill: Skill,
    patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">
  ): Promise<UpdatePropertiesResult> {
    if (skill.builtin)
      return fsFailure("Built-in skills cannot be edited or deleted. Disable the skill instead.");
    const fs = createNodeReconcileFs();
    const vaultRoot = resolveVaultRootAbs(this.app);
    const result = await this.runInternalMutation(
      () => runUpdateProperties({ skill, patch, fs }),
      (r) => (r.ok && vaultRoot !== null ? buildUpdatePropertiesExpectations(skill, vaultRoot) : [])
    );
    if (result.ok) {
      this.replaceManagedSkill(skill, applyPropertiesPatch(skill, patch));
    }
    return result.ok ? { ok: true } : fsFailure(result.reason);
  }

  async saveProperties(
    skill: Skill,
    req: {
      newName?: string;
      patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">;
    }
  ): Promise<SavePropertiesResult> {
    if (skill.builtin)
      return fsFailure("Built-in skills cannot be edited or deleted. Disable the skill instead.");
    const fs = createNodeReconcileFs();
    const newName =
      req.newName !== undefined && req.newName !== skill.name ? req.newName : undefined;
    const vaultRoot = resolveVaultRootAbs(this.app);
    let activeSkill = skill;

    if (newName !== undefined) {
      if (vaultRoot === null) {
        return noVaultPathFailure();
      }
      const folder = resolveSkillsFolder();
      const canonical = resolveAbsolutePath(this.app, folder);
      if (canonical === null) {
        return noVaultPathFailure();
      }

      const agentDirsAbs = this.resolveAgentDirsAbs(vaultRoot);
      const renameResult = await this.runInternalMutation(
        async () => {
          const result = await runRenameSkill({
            skill,
            newName,
            canonicalAbsRoot: canonical,
            agentDirsAbs,
            fs,
          });
          if (result.ok || (!result.ok && result.reason === "eperm")) {
            await this.cleanupLinksToSkill(fs, vaultRoot, skill.dirPath);
          }
          return result;
        },
        (r) =>
          r.ok || (!r.ok && r.reason === "eperm")
            ? buildRenameExpectations(skill, newName, canonical, agentDirsAbs, vaultRoot)
            : []
      );

      if (!renameResult.ok && renameResult.reason === "eperm") {
        skillManagerStore.set(epermSeenAtom, true);
      }

      if (!renameResult.ok && renameResult.reason !== "eperm") {
        if (renameResult.reason === "invalid") {
          return { ok: false, code: "invalid", message: "Skill name is invalid." };
        }
        if (renameResult.reason === "collision") {
          return {
            ok: false,
            code: "collision",
            message: "A skill with that name already exists.",
          };
        }
        if (renameResult.mutated === true) {
          void this.refresh();
        }
        return fsFailure(renameResult.reason);
      }

      activeSkill = buildRenamedSkill(skill, newName, canonical);
    }

    const patchResult = await this.runInternalMutation(
      () => runUpdateProperties({ skill: activeSkill, patch: req.patch, fs }),
      (r) =>
        r.ok && vaultRoot !== null ? buildUpdatePropertiesExpectations(activeSkill, vaultRoot) : []
    );
    if (!patchResult.ok) {
      if (newName !== undefined) {
        this.replaceManagedSkill(skill, activeSkill);
      }
      return fsFailure(patchResult.reason);
    }

    this.replaceManagedSkill(skill, applyPropertiesPatch(activeSkill, req.patch));
    return { ok: true };
  }

  async renameSkill(skill: Skill, newName: string): Promise<RenameSkillResult> {
    if (skill.builtin)
      return fsFailure("Built-in skills cannot be edited or deleted. Disable the skill instead.");
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
    const agentDirsAbs = this.resolveAgentDirsAbs(vaultRoot);
    const result = await this.runInternalMutation(
      async () => {
        const renameResult = await runRenameSkill({
          skill,
          newName,
          canonicalAbsRoot: canonical,
          agentDirsAbs,
          fs,
        });
        if (renameResult.ok || (!renameResult.ok && renameResult.reason === "eperm")) {
          await this.cleanupLinksToSkill(fs, vaultRoot, skill.dirPath);
        }
        return renameResult;
      },
      (r) =>
        r.ok || (!r.ok && r.reason === "eperm")
          ? buildRenameExpectations(skill, newName, canonical, agentDirsAbs, vaultRoot)
          : []
    );

    if (!result.ok && result.reason === "eperm") {
      skillManagerStore.set(epermSeenAtom, true);
    }

    if (result.ok || (!result.ok && result.reason === "eperm")) {
      this.replaceManagedSkill(skill, buildRenamedSkill(skill, newName, canonical));
    } else if (result.mutated === true) {
      void this.refresh();
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

  resolveCanonicalNameForMigration(name: string): string {
    const taken = new Set(
      skillManagerStore
        .get(skillsAtom)
        .filter((s) => s.location.kind === "canonical")
        .map((s) => s.name)
    );
    return suffixOnCollision(name, taken);
  }

  getSuppressMigrationConfirm(): boolean {
    return Boolean(getSettings().agentMode?.skills?.suppressMigrationConfirm);
  }

  setSuppressMigrationConfirm(value: boolean): void {
    const agentMode = getSettings().agentMode;
    const current = Boolean(agentMode?.skills?.suppressMigrationConfirm);
    if (current === value) return;
    updateSetting("agentMode", {
      ...agentMode,
      skills: {
        ...agentMode.skills,
        suppressMigrationConfirm: value,
      },
    });
  }

  async migrateProjectSkillForToggle(
    skill: Skill,
    targetAgent: BackendId | null,
    action: "expandToNewAgent" | "disableLastAgent" | "consolidate"
  ): Promise<MigrateSkillResult> {
    if (skill.location.kind !== "project") {
      return { ok: false, reason: "Skill is not project-managed." };
    }
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return { ok: false, reason: "Vault has no on-disk path on this platform." };
    }
    const folder = resolveSkillsFolder();
    const canonical = resolveAbsolutePath(this.app, folder);
    if (canonical === null) {
      return { ok: false, reason: "Vault has no on-disk path on this platform." };
    }

    const existingAgents = skill.location.agentDirs;
    let enabledAgentsAfter: BackendId[];
    switch (action) {
      case "expandToNewAgent":
        if (targetAgent === null) {
          return { ok: false, reason: "expandToNewAgent requires a targetAgent." };
        }
        enabledAgentsAfter = existingAgents.includes(targetAgent)
          ? [...existingAgents]
          : [...existingAgents, targetAgent];
        break;
      case "disableLastAgent":
        enabledAgentsAfter = [];
        break;
      case "consolidate":
        enabledAgentsAfter = [...existingAgents];
        break;
    }

    const agentDirsAbs = this.resolveAgentDirsAbs(vaultRoot);
    const duplicates = duplicateSourceDirsFor(skill, agentDirsAbs);
    const preTaken = skillManagerStore
      .get(skillsAtom)
      .filter((s) => s.location.kind === "canonical")
      .map((s) => s.name);

    const result = await this.runInternalMutation(() =>
      migrateProjectSkill({
        sourceName: skill.name,
        sourceDirAbs: skill.dirPath,
        duplicateSourceDirsAbs: duplicates,
        canonicalAbsRoot: canonical,
        enabledAgentsAfter,
        targetAgentDirsAbs: agentDirsAbs,
        preTakenNames: preTaken,
        fs: createNodeMigrateSkillFs(),
      })
    );

    if (!result.ok && result.reason === "eperm") {
      skillManagerStore.set(epermSeenAtom, true);
    }

    await this.refresh();
    return result;
  }

  async consolidateMirroredSkill(
    skill: Skill,
    suppressFuture: boolean
  ): Promise<MigrateSkillResult> {
    if (suppressFuture) this.setSuppressMigrationConfirm(true);
    return this.migrateProjectSkillForToggle(skill, null, "consolidate");
  }

  async removeProjectAgentDir(
    skill: Skill,
    agent: BackendId
  ): Promise<SkillOperationResult<"no-vault-path" | "unknown-agent" | "fs-error">> {
    if (skill.location.kind !== "project") {
      return { ok: false, code: "fs-error", message: "Skill is not project-managed." };
    }
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return noVaultPathFailure();
    }
    const agentDirAbs = this.resolveAgentDirAbs(vaultRoot, agent);
    if (agentDirAbs === null) {
      return { ok: false, code: "unknown-agent", message: `Unknown agent: ${agent}` };
    }
    const fs = createNodeReconcileFs();
    const targetDir = `${agentDirAbs.replace(/[/\\]+$/, "")}/${skill.name}`;
    const isLink = await fs.isSymlink(targetDir).catch(() => false);
    if (isLink) {
      await this.refresh();
      return { ok: true };
    }
    try {
      await this.runInternalMutation(() => fs.rmRecursive(targetDir));
    } catch (err) {
      return fsFailure(err instanceof Error ? err.message : String(err));
    }
    await this.refresh();
    return { ok: true };
  }

  private async runInternalMutation<T>(
    task: () => Promise<T>,
    buildExpectations?: (result: T) => Expectation[]
  ): Promise<T> {
    this.internalMutationDepth += 1;
    try {
      const result = await task();
      if (buildExpectations !== undefined) {
        this.installExpectations(buildExpectations(result));
      }
      return result;
    } finally {
      this.internalMutationDepth -= 1;
    }
  }

  private clearScheduledReconcile(): void {
    if (this.reconcileDebounceTimer === null) return;
    window.clearTimeout(this.reconcileDebounceTimer);
    this.reconcileDebounceTimer = null;
  }

  private installExpectations(expectations: Expectation[]): void {
    if (expectations.length === 0) return;
    this.pendingExpectations.push(...expectations);
    this.armSafetyTimer();
  }

  private armSafetyTimer(): void {
    this.clearSafetyTimer();
    this.safetyTimer = window.setTimeout(() => {
      this.safetyTimer = null;
      if (this.pendingExpectations.length === 0) return;
      const paths = this.pendingExpectations.map((e) => e.vaultRelPath).join(", ");
      logWarn(`[skills] Gave up waiting for vault events on: ${paths}`);
      this.pendingExpectations = [];
      this.scheduleReconcile();
    }, EXPECTATION_TIMEOUT_MS);
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer === null) return;
    window.clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
  }

  private tryMatchAndSuppress(eventPath: string): boolean {
    const matches = this.pendingExpectations.filter((exp) => matchExpectation(exp, eventPath));
    if (matches.length === 0) return false;
    for (const exp of matches) {
      void this.verifyAndMaybeConsume(exp);
    }
    return true;
  }

  private async verifyAndMaybeConsume(expectation: Expectation): Promise<void> {
    let satisfied: boolean;
    try {
      satisfied = await this.evaluateExpectation(expectation);
    } catch {
      satisfied = false;
    }
    if (!satisfied) return;
    this.consumeExpectation(expectation);
  }

  private async evaluateExpectation(expectation: Expectation): Promise<boolean> {
    switch (expectation.kind) {
      case "exists":
      case "subtree-exists":
        return this.app.vault.adapter.exists(expectation.vaultRelPath);
      case "missing":
      case "subtree-missing":
        return !(await this.app.vault.adapter.exists(expectation.vaultRelPath));
      case "modified":
        return true;
    }
  }

  private consumeExpectation(expectation: Expectation): void {
    const idx = this.pendingExpectations.indexOf(expectation);
    if (idx === -1) return;
    this.pendingExpectations.splice(idx, 1);
    if (this.pendingExpectations.length === 0) {
      this.clearSafetyTimer();
    }
  }

  private replaceManagedSkill(previous: Skill, next: Skill): void {
    const skills = skillManagerStore.get(skillsAtom);
    const index = skills.findIndex((s) => sameSkillIdentity(s, previous));
    const nextSkills =
      index === -1
        ? [...skills, next]
        : [...skills.slice(0, index), next, ...skills.slice(index + 1)];
    this.publishManagedSkills(sortSkills(nextSkills));
  }

  private removeManagedSkill(skill: Skill): void {
    const skills = skillManagerStore.get(skillsAtom);
    this.publishManagedSkills(skills.filter((s) => !sameSkillIdentity(s, skill)));
  }

  private publishManagedSkills(skills: Skill[]): void {
    skillManagerStore.set(skillsAtom, skills);
    this.publishSkillSetChanges(skills);
  }

  private async cleanupLinksToSkill(
    fs: ReturnType<typeof createNodeReconcileFs>,
    vaultRootAbs: string,
    skillDirPath: string
  ): Promise<void> {
    const report = await removeAgentLinksPointingTo(
      fs,
      this.resolveAgentDirsAbs(vaultRootAbs),
      skillDirPath
    );
    for (const error of report.errors) {
      logWarn(`[skills] Failed to remove stale skill link ${error.path}: ${error.reason}`);
    }
  }

  private subscribeToVaultEvents(): void {
    const handler = (file: TAbstractFile): void => {
      this.handleVaultEvent(file.path);
    };

    this.vaultEventRefs.push(this.app.vault.on("create", handler));
    this.vaultEventRefs.push(this.app.vault.on("delete", handler));
    this.vaultEventRefs.push(this.app.vault.on("modify", handler));
    this.vaultEventRefs.push(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        this.handleVaultEvent(file.path, oldPath);
      })
    );
  }

  private handleVaultEvent(newPath: string, oldPath?: string): void {
    if (this.internalMutationDepth > 0) return;
    const matchedNew = this.tryMatchAndSuppress(newPath);
    const matchedOld = oldPath !== undefined && this.tryMatchAndSuppress(oldPath);
    if (matchedNew || matchedOld) return;
    if (this.isWatchedPath(newPath) || (oldPath !== undefined && this.isWatchedPath(oldPath))) {
      this.scheduleReconcile();
    }
  }

  private isWatchedPath(relPath: string): boolean {
    const path = normalizeRelPath(relPath);
    const folder = normalizeRelPath(resolveSkillsFolder());
    if (path === folder || path.startsWith(`${folder}/`)) return true;
    return this.normalizedAgentDirs.some((root) => path === root || path.startsWith(`${root}/`));
  }

  private resolveAgentDirAbs(vaultRootAbs: string, agent: BackendId): string | null {
    const rel = this.agentDirsProjectRel[agent];
    if (rel === undefined) return null;
    return agentSkillsDirAbs(vaultRootAbs, rel);
  }

  private resolveAgentDirsAbs(vaultRootAbs: string): Record<BackendId, string> {
    const out: Record<BackendId, string> = {};
    for (const [agent, rel] of Object.entries(this.agentDirsProjectRel)) {
      out[agent] = agentSkillsDirAbs(vaultRootAbs, rel);
    }
    return out;
  }

  private scheduleReconcile(): void {
    this.clearScheduledReconcile();
    this.reconcileDebounceTimer = window.setTimeout(() => {
      this.reconcileDebounceTimer = null;
      void this.refresh();
    }, RECONCILE_DEBOUNCE_MS);
  }

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

function resolveVaultRootAbs(app: App): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  return normalizeAbsPath(adapter.getBasePath());
}

export function useManagedSkills(): Skill[] {
  return useAtomValue(skillsAtom, { store: skillManagerStore });
}

export function useRejectedSkills(): RejectedSkill[] {
  return useAtomValue(rejectedSkillsAtom, { store: skillManagerStore });
}

export function useEpermSeen(): boolean {
  return useAtomValue(epermSeenAtom, { store: skillManagerStore });
}

export function dismissEpermBanner(): void {
  skillManagerStore.set(epermSeenAtom, false);
}

export function getManagedSkills(): Skill[] {
  return skillManagerStore.get(skillsAtom);
}

export function getRejectedSkills(): RejectedSkill[] {
  return skillManagerStore.get(rejectedSkillsAtom);
}

function computeNextAgents(current: BackendId[], agent: BackendId, enabled: boolean): BackendId[] {
  const has = current.includes(agent);
  if (enabled && !has) return [...current, agent];
  if (!enabled && has) return current.filter((a) => a !== agent);
  return current;
}

function applyPropertiesPatch(
  skill: Skill,
  patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">
): Skill {
  const next: Skill = { ...skill };
  if ("description" in patch && typeof patch.description === "string") {
    next.description = patch.description;
  }
  if ("license" in patch) next.license = patch.license;
  if ("compatibility" in patch) next.compatibility = patch.compatibility;
  if ("allowedTools" in patch) next.allowedTools = patch.allowedTools;
  if ("model" in patch) next.model = patch.model;
  if ("disableModelInvocation" in patch) {
    next.disableModelInvocation = patch.disableModelInvocation;
  }
  if ("userInvocable" in patch) next.userInvocable = patch.userInvocable;
  return next;
}

function buildRenamedSkill(skill: Skill, newName: string, canonicalAbsRoot: string): Skill {
  const root =
    skill.location.kind === "project"
      ? normalizeAbsPath(parentDir(skill.dirPath))
      : normalizeAbsPath(canonicalAbsRoot);
  const dirPath = `${root}/${newName}`;
  return {
    ...skill,
    name: newName,
    dirPath,
    filePath: `${dirPath}/SKILL.md`,
  };
}

function sameSkillIdentity(a: Skill, b: Skill): boolean {
  return a.dirPath === b.dirPath;
}

function sortSkills(skills: Skill[]): Skill[] {
  return [...skills].sort(compareSkills);
}

const EMPTY_SKILL_SET_SIGNATURE = "skills:v1:0";

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

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function resolveSkillsFolder(): string {
  return getEffectiveSkillsFolder();
}

function resolveAbsolutePath(app: App, relFolder: string): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const base = adapter.getBasePath().replace(/[/\\]+$/, "");
  return `${base}/${relFolder}`;
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function createFsAdapter(app: App): SkillsFsAdapter {
  const adapter = app.vault.adapter;
  return {
    exists: (rel) => adapter.exists(rel),
    list: (rel) => adapter.list(rel),
    read: (rel) => adapter.read(rel),
  };
}

function noVaultPathFailure(): { ok: false; code: "no-vault-path"; message: string } {
  return {
    ok: false,
    code: "no-vault-path",
    message: "Vault has no on-disk path on this platform.",
  };
}

function fsFailure(message: string): { ok: false; code: "fs-error"; message: string } {
  return { ok: false, code: "fs-error", message };
}

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

function recordReconcileReport(report: ReconcileReport): void {
  if (report.errors.some((e) => e.reason === "eperm")) {
    skillManagerStore.set(epermSeenAtom, true);
  }
}
