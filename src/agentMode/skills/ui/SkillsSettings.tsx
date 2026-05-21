import { DEFAULT_SKILLS_FOLDER } from "@/agentMode/skills/agentPaths";
import { type BulkMoveResult } from "@/agentMode/skills/bulkMove";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import { DeleteConfirmModal } from "./DeleteConfirmDialog";
import { EmptyPlaceholder } from "./EmptyPlaceholder";
import {
  createEmptyImportDetectorResult,
  type ImportDetectorResult,
} from "@/agentMode/skills/importDetector";
import { ImportConsentDialog, type ImportPhase } from "./ImportConsentDialog";
import {
  PropertiesModal,
  type PropertiesSaveOutcome,
  type PropertiesSaveRequest,
} from "./PropertiesDialog";
import {
  dismissEpermBanner,
  SkillManager,
  totalCandidates,
  useEpermSeen,
  useManagedSkills,
} from "@/agentMode/skills/SkillManager";
import { SkillRow } from "./SkillRow";
import { type Skill } from "@/agentMode/skills/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { cn } from "@/lib/utils";
import { logError, logWarn } from "@/logger";
import { updateSetting, useSettingsValue, validateSkillsFolder } from "@/settings/model";
import { AlertTriangle, Folder, RotateCcw, Search } from "lucide-react";
import { FileSystemAdapter, Notice, TFile, TFolder } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Substring → brand-name lookup for the sync-folder warning banner. The
 * detection is case-insensitive against the absolute vault path, so the
 * substrings carry only their brand fragment.
 */
const SYNC_BRANDS: ReadonlyArray<{ substr: string; brand: string }> = [
  { substr: "onedrive", brand: "OneDrive" },
  { substr: "icloud", brand: "iCloud" },
  { substr: "dropbox", brand: "Dropbox" },
];

/**
 * Skills tab.
 *
 * Renders the header copy, the Skills-folder setting row, the toolbar
 * (search + count + "Find existing skills" rescan), and either the empty
 * placeholder or the Tidy list of {@link SkillRow}s sourced from
 * {@link SkillManager}.
 *
 * Wires per-agent toggles, overflow menu actions (Edit SKILL.md, Reveal
 * in vault, Delete), the delete confirmation modal, the EPERM banner,
 * and the sync-folder banner.
 */
export const SkillsSettings: React.FC = () => {
  const settings = useSettingsValue();
  // Brand projection of every registered backend. Sourced from the public
  // registry — descriptors are module-level constants so the list is stable
  // per session; the `useMemo` keeps the reference identity stable across
  // renders for child props.
  const agents = useMemo<ReadonlyArray<AgentBrand>>(
    () =>
      listBackendDescriptors().map(({ id, displayName, Icon }) => ({
        id,
        displayName,
        Icon,
      })),
    []
  );
  const persistedFolder = settings.agentMode.skills.folder;
  const skills = useManagedSkills();
  const epermSeen = useEpermSeen();

  const [draft, setDraft] = useState(persistedFolder);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");

  // Import flow state. Lifecycle: detecting → consent → running → results.
  // We start "closed" so the dialog doesn't flash on mount before detection
  // resolves. `dismissed` is a session-local sticky flag — per spec, there's
  // no persistent skip-list; the user has to click "Find existing skills"
  // to re-open the dialog after dismissing.
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);
  const [importCandidates, setImportCandidates] = useState<ImportDetectorResult>(() =>
    createEmptyImportDetectorResult(SkillManager.getInstance().getAgentDirsProjectRel())
  );
  const [importResults, setImportResults] = useState<BulkMoveResult | null>(null);
  const dismissedRef = useRef(false);
  // Anchor for Radix portals on this tab (e.g. SkillRow's overflow menu).
  // Portaling into the tab's own DOM keeps menus inside Obsidian's Settings
  // modal focus scope so Radix focus-follows-hover works.
  const containerRef = useRef<HTMLDivElement>(null);

  // Session-local banner-dismissal state. The sync-folder banner has its
  // own dismiss flag because the user can clear it independently of the
  // EPERM banner. Neither persists across plugin reloads — by design.
  const [syncBannerDismissed, setSyncBannerDismissed] = useState(false);

  // Keep the local draft in sync if persisted settings change underneath us
  // (e.g. via Reset Settings). We don't want to clobber the user's in-flight
  // typing, so only sync when the persisted value changes.
  useEffect(() => {
    setDraft(persistedFolder);
    setValidationError(null);
  }, [persistedFolder]);

  // Trigger a discovery pass on mount and on persisted-folder change so
  // the list reflects whatever lives at the currently configured path.
  useEffect(() => {
    void SkillManager.getInstance().refresh();
  }, [persistedFolder]);

  // Run import detection once on mount (and again when the folder changes,
  // since "what counts as managed" depends on the canonical path). Skips
  // the dialog if the user already dismissed it this session — `dismissedRef`
  // is intentionally sticky across folder changes within the same session;
  // the documented escape hatch is the "Find existing skills" toolbar button
  // (`handleRescan`), which resets the flag and re-runs detection.
  useEffect(() => {
    if (dismissedRef.current) return;
    const manager = SkillManager.getInstance();

    let cancelled = false;
    void (async () => {
      const candidates = await manager.detectImports();
      if (cancelled) return;
      if (totalCandidates(candidates) === 0) return;
      setImportCandidates(candidates);
      setImportPhase("consent");
    })();
    return () => {
      cancelled = true;
    };
  }, [persistedFolder]);

  /** Validate the draft against `validateSkillsFolder`; updates inline error state. */
  const validate = useCallback((value: string) => {
    const result = validateSkillsFolder(value);
    if (!result.ok) {
      setValidationError(result.reason);
      return null;
    }
    setValidationError(null);
    return result.folder;
  }, []);

  /** Persist the draft when it is valid; called on blur and on Enter. */
  const commit = useCallback(
    (value: string) => {
      const folder = validate(value);
      if (folder === null) return;
      if (folder === persistedFolder) return;
      try {
        updateSetting("agentMode", {
          ...settings.agentMode,
          skills: { ...settings.agentMode.skills, folder },
        });
      } catch (err) {
        logError("Failed to persist skills folder", err);
        new Notice("Failed to save skills folder. See console for details.");
      }
    },
    [persistedFolder, settings.agentMode, validate]
  );

  /** Folder-picker icon button. Not wired yet — opens a notice telling the user to type the path. */
  const handlePickFolder = useCallback(() => {
    new Notice("Folder picker is not available yet — type the vault-relative path for now.");
  }, []);

  /**
   * "Find existing skills" — clears any persisted skip-list of failed
   * sources, re-runs detection, and re-opens the dialog. The button is
   * the documented retry escape hatch for skills that previously failed
   * to move.
   */
  const handleRescan = useCallback(() => {
    const manager = SkillManager.getInstance();
    manager.clearImportSkipList();
    void (async () => {
      const candidates = await manager.detectImports();
      if (totalCandidates(candidates) === 0) {
        new Notice("No skills detected outside the canonical folder.");
        // Also refresh the grid so any external changes show up.
        void manager.refresh();
        return;
      }
      // Reset dismissal so a future programmatic re-open could fire.
      dismissedRef.current = false;
      setImportCandidates(candidates);
      setImportResults(null);
      setImportPhase("consent");
    })();
  }, []);

  /** Primary action on the consent screen — runs the bulk move. */
  const handleImportConfirm = useCallback(() => {
    const manager = SkillManager.getInstance();
    const flat = Object.values(importCandidates).flat();
    setImportPhase("running");
    void (async () => {
      try {
        const result = await manager.runImport(flat);
        setImportResults(result);
        setImportPhase("results");
      } catch (err) {
        logError("Bulk import failed", err);
        new Notice("Bulk import failed. See console for details.");
        setImportPhase(null);
      }
    })();
  }, [importCandidates]);

  /** Secondary action on the consent screen — closes without moving. */
  const handleImportDismiss = useCallback(() => {
    dismissedRef.current = true;
    setImportPhase(null);
  }, []);

  /** "Done" on the results screen — closes the dialog and refreshes. */
  const handleDone = useCallback(() => {
    setImportPhase(null);
    void SkillManager.getInstance().refresh();
  }, []);

  /** Radix-driven open/close — closing mid-flow counts as "dismiss". */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      if (importPhase === "results") {
        handleDone();
      } else {
        handleImportDismiss();
      }
    },
    [importPhase, handleDone, handleImportDismiss]
  );

  /** Toggle a single agent for the given skill. Optimistic + heals on failure. */
  const handleToggleAgent = useCallback(async (skill: Skill, agent: BackendId) => {
    const manager = SkillManager.getInstance();
    const enabled = !skill.enabledAgents.includes(agent);
    const result = await manager.toggleAgent(skill, agent, enabled);
    if (!result.ok && result.code !== "eperm") {
      new Notice(`Could not ${enabled ? "enable" : "disable"} ${agent}: ${result.message}`);
    }
  }, []);

  /**
   * Open a SKILL.md (absolute path) for editing. Managed skills live inside
   * the visible vault and open in Obsidian. Failed-import sources live under
   * agent dotfile folders (e.g. `.claude/skills/`) that Obsidian doesn't
   * index — falling through `openLinkText` there triggers a "Folder already
   * exists" error as it tries to create a new note, so we hand those off to
   * the OS default editor via Electron's shell instead.
   */
  const handleOpenSkillMdAbsPath = useCallback((absPath: string) => {
    const vaultRel = vaultRelativePath(absPath);
    if (vaultRel !== null && app.vault.getAbstractFileByPath(vaultRel) instanceof TFile) {
      void app.workspace.openLinkText(vaultRel, "", true);
      return;
    }
    void openWithSystemDefault(absPath);
  }, []);

  /** Open the canonical SKILL.md of a managed skill in Obsidian's editor. */
  const handleEditSkillMd = useCallback(
    (skill: Skill) => {
      handleOpenSkillMdAbsPath(skill.filePath);
    },
    [handleOpenSkillMdAbsPath]
  );

  /** Reveal the canonical skill folder in Obsidian's file explorer. */
  const handleRevealInVault = useCallback((skill: Skill) => {
    const folderRel = vaultRelativePath(skill.dirPath);
    if (folderRel === null) {
      new Notice("Could not resolve the skill folder inside this vault.");
      return;
    }
    revealInFileExplorer(folderRel);
  }, []);

  const filteredSkills = useMemo(() => filterSkills(skills, searchValue), [skills, searchValue]);

  const displayFolder = persistedFolder.length > 0 ? persistedFolder : DEFAULT_SKILLS_FOLDER;

  /**
   * Open the per-skill Properties modal. The modal owns its own save and
   * collision state; the `onSave` callback runs the rename + patch and
   * reports back whether the modal should close, stay open, or show a
   * name-collision inline error.
   */
  const handleEditProperties = useCallback(
    (skill: Skill) => {
      new PropertiesModal(
        app,
        skill,
        displayFolder,
        async (req: PropertiesSaveRequest): Promise<PropertiesSaveOutcome> => {
          const manager = SkillManager.getInstance();
          const result = await manager.saveProperties(skill, {
            newName: req.nameChanged ? req.newName : undefined,
            patch: req.patch,
          });
          if (!result.ok) {
            if (result.code === "collision") return "collision";
            if (result.code === "invalid") {
              // Shouldn't happen — the modal gates Save on inline validation.
              return "stay";
            }
            new Notice(
              `Could not update ${req.nameChanged ? req.newName : skill.name}: ${result.message}`
            );
            return "stay";
          }
          return "close";
        }
      ).open();
    },
    [displayFolder]
  );

  /** Open the native delete confirmation modal. */
  const handleAskDelete = useCallback(
    (skill: Skill) => {
      const manager = SkillManager.getInstance();
      new DeleteConfirmModal(
        app,
        skill,
        displayFolder,
        manager.getAgentDirsProjectRel(),
        async () => {
          const result = await manager.deleteSkill(skill);
          if (!result.ok) {
            new Notice(`Failed to delete ${skill.name}: ${result.message}`);
          }
        }
      ).open();
    },
    [displayFolder]
  );

  // Detect a sync-folder vault on every render — the absolute path is
  // stable across the session so the work is trivial.
  const syncBrand = useMemo(() => detectSyncBrand(), []);

  const dialogPhase = importPhase ?? "consent";
  const dialogOpen = importPhase !== null;

  return (
    <div ref={containerRef} className="tw-space-y-4">
      <section>
        <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">Skills</div>
          <div className="tw-text-sm tw-text-muted">
            Skills are little instruction packets your agents can run — things like &ldquo;review a
            diff&rdquo; or &ldquo;write a release note&rdquo;. Each one lives once in your vault and
            can be turned on for any agent.
          </div>
        </div>

        <SettingItem
          type="custom"
          title="Skills folder"
          description={
            <div className="tw-flex tw-flex-col tw-gap-1">
              <span>
                Where Copilot keeps the canonical copy of every skill. Agent shortcuts point here.
                Changing this moves the folder and rewrites all shortcuts.
              </span>
              {validationError !== null && <span className="tw-text-error">{validationError}</span>}
            </div>
          }
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <Input
              value={draft}
              onChange={(e) => {
                const next = e.target.value;
                setDraft(next);
                validate(next);
              }}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(draft);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="copilot/skills"
              className="!tw-w-56"
              aria-label="Skills folder"
              aria-invalid={validationError !== null}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePickFolder}
              title="Pick folder"
              aria-label="Pick folder"
            >
              <Folder className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>

        {/* Durable banners — stack at the top of the tab body, above the toolbar. */}
        {(epermSeen || (syncBrand !== null && !syncBannerDismissed)) && (
          <div className="tw-mt-3 tw-flex tw-flex-col tw-gap-2">
            {epermSeen && <EpermBanner onDismiss={dismissEpermBanner} />}
            {syncBrand !== null && !syncBannerDismissed && (
              <SyncFolderBanner brand={syncBrand} onDismiss={() => setSyncBannerDismissed(true)} />
            )}
          </div>
        )}

        {/* Toolbar — search + count + rescan */}
        <div className="tw-mt-4 tw-flex tw-items-center tw-gap-2">
          <div className="tw-relative tw-flex-1 sm:tw-flex-initial">
            <Search
              className="tw-pointer-events-none tw-absolute tw-left-2.5 tw-top-1/2 tw-size-4 tw--translate-y-1/2 tw-text-faint"
              aria-hidden="true"
            />
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search skills…"
              className="!tw-w-full !tw-pl-8 sm:!tw-w-64"
              aria-label="Search skills"
            />
          </div>
          <span className="tw-text-xs tw-text-muted">{formatSkillCount(skills.length)}</span>
          <div className="tw-flex-1" />
          <Button
            variant="secondary"
            onClick={handleRescan}
            title="Re-scan agent folders and retry previously-failed sources"
            className="tw-gap-1.5"
          >
            <RotateCcw className="tw-size-4" aria-hidden="true" />
            Find existing skills
          </Button>
        </div>

        {/* Body — empty placeholder, or the Tidy list. */}
        <div className="tw-mt-4">
          {skills.length === 0 ? (
            <EmptyPlaceholder folder={displayFolder} />
          ) : (
            <div className="tw-flex tw-flex-col tw-gap-1.5">
              {filteredSkills.length === 0 ? (
                <div className="tw-rounded-md tw-border tw-border-dashed tw-border-border tw-bg-primary tw-px-3.5 tw-py-6 tw-text-center tw-text-ui-smaller tw-text-muted">
                  No skills match &ldquo;{searchValue}&rdquo;.
                </div>
              ) : (
                filteredSkills.map((skill) => (
                  <SkillRow
                    key={skill.dirPath}
                    skill={skill}
                    agents={agents}
                    onToggleAgent={(agent) => handleToggleAgent(skill, agent)}
                    onEditSkillMd={() => handleEditSkillMd(skill)}
                    onEditProperties={() => handleEditProperties(skill)}
                    onRevealInVault={() => handleRevealInVault(skill)}
                    onDelete={() => handleAskDelete(skill)}
                    containerRef={containerRef}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </section>

      <ImportConsentDialog
        open={dialogOpen}
        onOpenChange={handleOpenChange}
        phase={dialogPhase}
        agents={agents}
        candidates={importCandidates}
        results={importResults}
        folder={displayFolder}
        agentDirsProjectRel={SkillManager.getInstance().getAgentDirsProjectRel()}
        onConfirm={handleImportConfirm}
        onDismiss={handleImportDismiss}
        onDone={handleDone}
        onEditSkillMd={handleOpenSkillMdAbsPath}
      />
    </div>
  );
};

/**
 * Windows-EPERM warn banner. Verbatim copy is product-blessed; the title
 * + paragraph split mirrors wireframe state H.
 */
const EpermBanner: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  return (
    <div
      className={cn(
        "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-warning/100",
        "tw-bg-callout-warning/20 tw-px-3.5 tw-py-2.5 tw-text-ui-smaller tw-text-warning"
      )}
      role="alert"
    >
      <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" aria-hidden="true" />
      <div className="tw-flex-1">
        <span className="tw-block tw-font-semibold">
          Windows needs Developer Mode for multi-agent fanout.
        </span>
        <span className="tw-mt-0.5 tw-block tw-text-normal">
          Creating shortcuts in your agent folders requires admin, or Settings → Privacy &amp;
          security → For developers → Developer Mode. Until then, agent toggles flip in the file but
          no shortcut is created.
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        // Preflight is off: zero the native button chrome inline so the
        // dismiss ✕ doesn't render as a beveled grey square.
        style={{ appearance: "none", border: 0, background: "transparent", padding: 0 }}
        className="tw-px-1 tw-text-faint hover:tw-text-normal"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

/**
 * Sync-folder info banner. Brand name is computed at mount from the
 * vault's absolute path. Verbatim copy is product-blessed.
 */
const SyncFolderBanner: React.FC<{ brand: string; onDismiss: () => void }> = ({
  brand,
  onDismiss,
}) => {
  return (
    <div
      className={cn(
        "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-blue/80",
        "tw-bg-blue-rgb/10 tw-px-3.5 tw-py-2.5 tw-text-ui-smaller tw-text-normal"
      )}
      role="status"
    >
      <div className="tw-flex-1">
        <span className="tw-block tw-font-semibold">This vault is inside {brand}.</span>
        <span className="tw-mt-0.5 tw-block tw-text-muted">
          Sync sometimes replaces directory junctions with shortcuts. If a skill disappears from an
          agent after a sync, re-toggle it here to recreate the link.
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        // Preflight is off: zero the native button chrome inline so the
        // dismiss ✕ doesn't render as a beveled grey square.
        style={{ appearance: "none", border: 0, background: "transparent", padding: 0 }}
        className="tw-px-1 tw-text-faint hover:tw-text-normal"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

/** Case-insensitive substring filter on name + description. */
function filterSkills(skills: Skill[], query: string): Skill[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return skills;
  return skills.filter(
    (s) => s.name.toLowerCase().includes(trimmed) || s.description.toLowerCase().includes(trimmed)
  );
}

/** Pluralise the skill count for the toolbar. */
function formatSkillCount(n: number): string {
  return `${n} skill${n === 1 ? "" : "s"}`;
}

/**
 * Open an absolute file path with the OS default app. Used when a SKILL.md
 * lives under an agent dotfile folder that Obsidian doesn't index. Returns
 * via a `Notice` on failure so the user still sees a path they can paste
 * into their own editor.
 */
async function openWithSystemDefault(absPath: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as {
      shell?: { openPath?: (path: string) => Promise<string> };
      remote?: { shell?: { openPath?: (path: string) => Promise<string> } };
    };
    const shell = electron.shell ?? electron.remote?.shell;
    if (!shell?.openPath) {
      new Notice(`Open this file to edit it: ${absPath}`);
      return;
    }
    const errMsg = await shell.openPath(absPath);
    if (typeof errMsg === "string" && errMsg.length > 0) {
      logError(`[skills] shell.openPath failed for ${absPath}: ${errMsg}`);
      new Notice(`Could not open SKILL.md: ${errMsg}`);
    }
  } catch (err) {
    logError(`[skills] openWithSystemDefault failed for ${absPath}:`, err);
    new Notice(`Open this file to edit it: ${absPath}`);
  }
}

/**
 * Convert an absolute path returned by `SkillManager` into a vault-relative
 * POSIX path suitable for `openLinkText` / `revealInFolder`. Returns `null`
 * if the vault has no `FileSystemAdapter` or the absolute path lies outside
 * the vault.
 */
function vaultRelativePath(absPath: string): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const base = adapter.getBasePath().replace(/[/\\]+$/, "");
  const norm = absPath.replace(/\\/g, "/");
  const baseNorm = base.replace(/\\/g, "/");
  if (norm === baseNorm) return "";
  const prefix = `${baseNorm}/`;
  if (!norm.startsWith(prefix)) return null;
  return norm.slice(prefix.length);
}

/**
 * Reveal a vault-relative folder in Obsidian's internal file-explorer
 * plugin. Falls back to a Notice if the explorer isn't installed or the
 * folder isn't in the vault cache (hidden dotfile folder, etc.).
 */
function revealInFileExplorer(relPath: string): void {
  const folder = app.vault.getAbstractFileByPath(relPath);
  if (folder instanceof TFolder) {
    const fileExplorer = (
      app as unknown as {
        internalPlugins?: {
          getPluginById?: (id: string) =>
            | {
                enabled?: boolean;
                instance?: { revealInFolder?: (folder: TFolder) => void };
              }
            | undefined;
        };
      }
    ).internalPlugins?.getPluginById?.("file-explorer");
    if (fileExplorer?.enabled && fileExplorer.instance?.revealInFolder) {
      fileExplorer.instance.revealInFolder(folder);
      return;
    }
    logWarn("[skills] File Explorer plugin unavailable; cannot reveal folder.");
    new Notice("File Explorer isn't enabled; can't reveal the folder.");
    return;
  }
  // Hidden folders aren't in the vault cache. Surface a friendly notice
  // rather than failing silently.
  new Notice(
    `Skill folder "${relPath}" isn't indexed by Obsidian — open it from your file manager.`
  );
}

/**
 * Detect whether the vault path contains a well-known sync-client folder
 * fragment. Returns the brand name to display, or `null` when the vault
 * doesn't appear to be under a known sync root.
 */
function detectSyncBrand(): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const base = adapter.getBasePath().toLowerCase();
  for (const { substr, brand } of SYNC_BRANDS) {
    if (base.includes(substr)) return brand;
  }
  return null;
}
