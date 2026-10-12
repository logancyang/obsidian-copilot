import { availableBuiltinAgents } from "@/agentMode/skills/builtin/reconcileBuiltinSkills";
import { useBackendInstallStates } from "@/agentMode/session/useBackendInstallStates";
import { ALL_MANAGED_SKILLS, planManagedBuiltins } from "@/builtinSkills/builtinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { BuiltinSkillsTable } from "./BuiltinSkillsTable";
import { formatSkillDisplayName } from "@/agentMode/skills/mergeDiscovery";
import {
  buildSkillRepairPrompt,
  type SkillRepairEvidence,
} from "@/agentMode/skills/skillRepairPrompt";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand } from "@/agentMode/session/types";
import { DeleteConfirmModal } from "./DeleteConfirmDialog";
import { EmptyPlaceholder } from "./EmptyPlaceholder";
import {
  AllSkillsNotLoaded,
  SkillLoadIssues,
  SkillLoadIssuesModal,
  type SkillLoadIssue,
} from "./SkillLoadIssues";
import {
  PropertiesModal,
  type PropertiesSaveOutcome,
  type PropertiesSaveRequest,
} from "./PropertiesDialog";
import {
  dismissEpermBanner,
  SkillManager,
  useEpermSeen,
  useManagedSkills,
  useRejectedSkills,
} from "@/agentMode/skills/SkillManager";
import { SkillRow } from "./SkillRow";
import { type Skill } from "@/agentMode/skills/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deriveSkillsFolder } from "@/settings/copilotFolder";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { openVaultPath } from "@/utils/openVaultPath";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { useSettingsValue } from "@/settings/model";
import { AlertTriangle, Search } from "lucide-react";
import { App, FileSystemAdapter, Notice, TFolder } from "obsidian";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SYNC_BRANDS: ReadonlyArray<{ substr: string; brand: string }> = [
  { substr: "onedrive", brand: "OneDrive" },
  { substr: "icloud", brand: "iCloud" },
  { substr: "dropbox", brand: "Dropbox" },
];

const BUILTIN_ROWS = ALL_MANAGED_SKILLS.map((skill) => ({
  name: skill.name,
  description: parseSkillFile(skill.skillMd, skill.name).frontmatter.description,
  content: skill.skillMd,
  enabledAgents: skill.enabledAgents,
}));

export const SkillsSettings: React.FC = () => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const skillsFolder = deriveSkillsFolder(settings);
  const descriptors = useMemo(() => listBackendDescriptors(), []);
  const agents = useMemo<ReadonlyArray<AgentBrand>>(
    () =>
      descriptors.map(({ id, displayName, Icon }) => ({
        id,
        displayName,
        Icon,
      })),
    [descriptors]
  );
  const skills = useManagedSkills();
  const rejectedSkills = useRejectedSkills();
  const epermSeen = useEpermSeen();

  const [searchValue, setSearchValue] = useState("");
  const [builtinPending, setBuiltinPending] = useState<readonly string[]>([]);
  const [builtinError, setBuiltinError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const userSkills = useMemo(() => skills.filter((skill) => !skill.builtin), [skills]);
  const installStates = useBackendInstallStates(plugin, descriptors);
  const lastAvailableAgents = useRef<readonly string[]>(
    skills.filter((skill) => skill.builtin).flatMap((skill) => skill.enabledAgents)
  );
  const availableAgents = availableBuiltinAgents(installStates, lastAvailableAgents.current);
  lastAvailableAgents.current = availableAgents;
  const eligibleBuiltins = planManagedBuiltins({
    search: settings.enableMiyoSearchSkill === true,
    documents: settings.docProcessorBackend === "miyo",
  }).seed;
  const unavailableReasons: Record<string, string> = {};
  for (const skill of eligibleBuiltins) {
    const collision =
      userSkills.some(
        (userSkill) => userSkill.name === skill.name && userSkill.location.kind === "canonical"
      ) ||
      rejectedSkills.some(
        (rejected) =>
          toVaultRelative(rejected.dirPath, getVaultBase(app)) === `${skillsFolder}/${skill.name}`
      );
    if (collision) {
      unavailableReasons[skill.name] =
        "A skill with this name already exists in Your Skills. Your file is kept unchanged.";
    }
  }
  const builtinRows = BUILTIN_ROWS.filter(
    (skill) =>
      eligibleBuiltins.some((builtin) => builtin.name === skill.name) &&
      `${skill.name} ${skill.description}`.toLowerCase().includes(searchValue.trim().toLowerCase())
  );

  const handleBuiltinChange = useCallback(
    async (name: string, enabled: boolean, agent?: string) => {
      setBuiltinPending((names) => [...names, name]);
      setBuiltinError(undefined);
      try {
        const manager = SkillManager.getInstance();
        const result =
          agent === undefined
            ? await manager.setBuiltinSkillEnabled(name, enabled)
            : await manager.setBuiltinAgentEnabled(name, agent, enabled);
        if (!result.ok) setBuiltinError(result.message);
        else setRefreshError(undefined);
      } catch (error) {
        setBuiltinError(
          `Could not update ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        setBuiltinPending((names) => names.filter((pendingName) => pendingName !== name));
      }
    },
    []
  );
  const handleToggleBuiltinSkill = useCallback(
    (name: string, enabled: boolean) => {
      void handleBuiltinChange(name, enabled);
    },
    [handleBuiltinChange]
  );
  const handleToggleBuiltinAgent = useCallback(
    (name: string, agent: string, enabled: boolean) => {
      void handleBuiltinChange(name, enabled, agent);
    },
    [handleBuiltinChange]
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const [syncBannerDismissed, setSyncBannerDismissed] = useState(false);

  // Refresh on focus: fixing a hidden agent file in an external editor bypasses Obsidian's
  // watcher. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  useEffect(() => {
    const manager = SkillManager.getInstance();
    let active = true;
    const refresh = async () => {
      const result = await manager.refresh();
      if (active) {
        setRefreshError(
          result.reconcileError ??
            result.discoveryError ??
            (result.reconcileErrorCount > 0
              ? "Some skill links could not be updated. Check folder permissions."
              : undefined)
        );
      }
    };
    void refresh();
    const hostWindow = containerRef.current?.win;
    const handleFocus = (): void => {
      void refresh();
    };
    hostWindow?.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      hostWindow?.removeEventListener("focus", handleFocus);
    };
  }, [skillsFolder]);

  const handleEditSkillMd = useCallback(
    (skill: Skill) => {
      openVaultPath(app, skill.filePath, { newLeaf: true });
    },
    [app]
  );

  // Hidden agent folders are outside Obsidian's index, so they cannot use the vault reveal
  // path. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  const handleRevealSkillFolder = useCallback(
    (dirPath: string) => {
      const folderRel = toVaultRelative(dirPath, getVaultBase(app));
      if (app.vault.getAbstractFileByPath(folderRel) instanceof TFolder) {
        void revealFolderInExplorer(app, folderRel);
        return;
      }
      void openWithSystemDefault(dirPath);
    },
    [app]
  );

  const handleFixWithAgent = useCallback(
    (issues: readonly SkillRepairEvidence[]): void => {
      (app as unknown as { setting: { close: () => void } }).setting.close();
      void plugin.newAgentChatWithDraft(buildSkillRepairPrompt(issues));
    },
    [app, plugin]
  );

  const loadIssues = useMemo<SkillLoadIssue[]>(() => {
    const vaultBase = getVaultBase(app);
    return rejectedSkills.map((skill) => {
      const folderRel = toVaultRelative(skill.dirPath, vaultBase);
      const indexed = app.vault.getAbstractFileByPath(folderRel) instanceof TFolder;
      const evidence: SkillRepairEvidence = {
        location: toVaultRelative(skill.filePath, vaultBase),
        reason: skill.reason,
        offendingText: skill.offendingText,
      };
      return {
        ...evidence,
        revealLabel: indexed ? "Reveal in vault" : "Show in folder",
        onFixWithAgent: () => handleFixWithAgent([evidence]),
        onOpen: () => openVaultPath(app, skill.filePath, { newLeaf: true }),
        onReveal: () => handleRevealSkillFolder(skill.dirPath),
      };
    });
  }, [app, handleFixWithAgent, handleRevealSkillFolder, rejectedSkills]);

  const filteredSkills = useMemo(
    () => filterSkills(userSkills, searchValue),
    [userSkills, searchValue]
  );

  const displayFolder = skillsFolder;

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
    [app, displayFolder]
  );

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
    [app, displayFolder]
  );

  const syncBrand = useMemo(() => detectSyncBrand(app), [app]);

  return (
    <div ref={containerRef} className="tw-space-y-4">
      <section>
        <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">Skills</div>
          <div className="tw-text-sm tw-text-muted">
            Skills are instruction packets your agents can run - things like &ldquo;review a
            diff&rdquo; or &ldquo;write a release note&rdquo;. Skills you put under your shared
            folder, or directly inside an agent&rsquo;s own skills folder, show up here
            automatically.
          </div>
        </div>

        {refreshError && (
          <div role="alert" className="tw-text-ui-smaller tw-text-error">
            {refreshError}
          </div>
        )}

        {(epermSeen || (syncBrand !== null && !syncBannerDismissed)) && (
          <div className="tw-mt-3 tw-flex tw-flex-col tw-gap-2">
            {epermSeen && <EpermBanner onDismiss={dismissEpermBanner} />}
            {syncBrand !== null && !syncBannerDismissed && (
              <SyncFolderBanner brand={syncBrand} onDismiss={() => setSyncBannerDismissed(true)} />
            )}
          </div>
        )}

        {loadIssues.length > 0 && (
          <div className="tw-mt-3">
            <SkillLoadIssues
              issues={loadIssues}
              onViewDetails={() =>
                new SkillLoadIssuesModal(app, loadIssues, () =>
                  handleFixWithAgent(loadIssues)
                ).open()
              }
            />
          </div>
        )}

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
          <span className="tw-text-xs tw-text-muted">{userSkills.length} loaded</span>
        </div>

        <div className="tw-mt-4" role="region" aria-label="Your Skills">
          <div
            role="heading"
            aria-level={3}
            className="tw-mb-3 tw-text-left tw-text-base tw-font-semibold"
          >
            Your Skills
          </div>
          {userSkills.length === 0 ? (
            // Rejected files prove skills exist; the empty state would claim there are none. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
            rejectedSkills.length > 0 ? (
              <AllSkillsNotLoaded />
            ) : (
              <EmptyPlaceholder folder={displayFolder} />
            )
          ) : (
            <div className="tw-flex tw-flex-col tw-gap-1.5">
              {filteredSkills.length === 0 ? (
                <div className="tw-rounded-sm tw-border tw-border-dashed tw-border-border tw-bg-primary tw-px-3 tw-py-6 tw-text-center tw-text-ui-smaller tw-text-muted">
                  No skills match &ldquo;{searchValue}&rdquo;.
                </div>
              ) : (
                filteredSkills.map((skill) => (
                  <SkillRow
                    key={skill.dirPath}
                    skill={skill}
                    agents={agents}
                    agentDirsProjectRel={SkillManager.getInstance().getAgentDirsProjectRel()}
                    onEditSkillMd={() => handleEditSkillMd(skill)}
                    onEditProperties={() => handleEditProperties(skill)}
                    onRevealInVault={() => handleRevealSkillFolder(skill.dirPath)}
                    onDelete={() => handleAskDelete(skill)}
                    containerRef={containerRef}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </section>
      <BuiltinSkillsTable
        skills={builtinRows}
        preferences={settings.agentMode.skills.builtinPreferences}
        unavailableReasons={unavailableReasons}
        agents={agents}
        availableAgents={availableAgents}
        pendingSkills={builtinPending}
        error={builtinError}
        onToggleSkill={handleToggleBuiltinSkill}
        onToggleAgent={handleToggleBuiltinAgent}
      />
    </div>
  );
};

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
        style={{ appearance: "none", border: 0, background: "transparent", padding: 0 }}
        className="tw-px-1 tw-text-faint hover:tw-text-normal"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

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
        style={{ appearance: "none", border: 0, background: "transparent", padding: 0 }}
        className="tw-px-1 tw-text-faint hover:tw-text-normal"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

function filterSkills(skills: Skill[], query: string): Skill[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return skills;
  return skills.filter(
    (s) =>
      formatSkillDisplayName(s).toLowerCase().includes(trimmed) ||
      s.description.toLowerCase().includes(trimmed)
  );
}

function detectSyncBrand(app: App): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const base = adapter.getBasePath().toLowerCase();
  for (const { substr, brand } of SYNC_BRANDS) {
    if (base.includes(substr)) return brand;
  }
  return null;
}
