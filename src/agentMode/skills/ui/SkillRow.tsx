import { SkillRowLayout } from "./SkillRowLayout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Edit3, FolderSearch, MoreVertical, Move, Settings, Trash2 } from "lucide-react";
import { Notice, type App } from "obsidian";
import React from "react";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { getEffectiveSkillsFolder } from "@/settings/copilotFolder";
import { SkillManager } from "@/agentMode/skills/SkillManager";
import { decideToggleAction } from "@/agentMode/skills/toggleDecision";
import { formatSkillDisplayName } from "@/agentMode/skills/mergeDiscovery";
import type { Skill } from "@/agentMode/skills/types";
import {
  MigrateSkillConfirmModal,
  type MigrateActionLine,
  type MigrateConfirmVariant,
} from "./MigrateSkillConfirmModal";
import { AgentIconButton } from "./AgentIconButton";

interface SkillRowProps {
  skill: Skill;
  agents: ReadonlyArray<AgentBrand>;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  onEditSkillMd?: () => void;
  onEditProperties?: () => void;
  onRevealInVault?: () => void;
  onDelete?: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

export const SkillRow: React.FC<SkillRowProps> = ({
  skill,
  agents,
  agentDirsProjectRel,
  onEditSkillMd,
  onEditProperties,
  onRevealInVault,
  onDelete,
  containerRef,
}) => {
  const app = useApp();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const chips = computeChips(skill);
  const enabledAgents = React.useMemo(() => new Set(skill.enabledAgents), [skill.enabledAgents]);
  const displayName = formatSkillDisplayName(skill);
  const locationLabel = buildLocationLabel(skill, agentDirsProjectRel);

  const lockdownCount = skill.location.kind === "project" ? skill.location.agentDirs.length : 0;
  const mirroredLockdown = lockdownCount >= 2;
  const lockdownTooltip = mirroredLockdown
    ? `This skill is duplicated in ${lockdownCount} agent folders. ` +
      `Editing one copy would silently diverge from the others. ` +
      `Migrate it to your shared folder first to enable edits.`
    : null;

  const handleToggleAgent = React.useCallback(
    async (agent: BackendId): Promise<void> => {
      const manager = SkillManager.getInstance();
      const willBeEnabled = !enabledAgents.has(agent);
      const decision = decideToggleAction(skill, agent, willBeEnabled);
      switch (decision.kind) {
        case "no-op":
          return;
        case "canonical-toggle": {
          const result = await manager.toggleAgent(skill, agent, decision.enabled);
          if (!result.ok && result.code !== "eperm") {
            new Notice(
              `Could not ${decision.enabled ? "enable" : "disable"} ${agent}: ${result.message}`
            );
          }
          return;
        }
        case "mirrored-remove-one": {
          const result = await manager.removeProjectAgentDir(skill, decision.agent);
          if (!result.ok) {
            new Notice(`Could not remove ${skill.name} from ${decision.agent}: ${result.message}`);
            return;
          }
          const survivors = (
            skill.location.kind === "project" ? skill.location.agentDirs : []
          ).filter((a) => a !== decision.agent);
          const survivorLabel = survivors.length === 1 ? survivors[0] : survivors.join(", ");
          new Notice(
            `Removed ${skill.name} from ${decision.agent} project folder; still active in ${survivorLabel}.`
          );
          return;
        }
        case "migrate-confirm": {
          await runMigration({
            app,
            skill,
            agentDirsProjectRel,
            variant: decision.variant,
            targetAgent: decision.targetAgent,
            targetAgentDisplayName: agentDisplayName(agents, decision.targetAgent),
            action: decision.action,
          });
          return;
        }
        default: {
          const _exhaustive: never = decision;
          void _exhaustive;
          return;
        }
      }
    },
    [agents, agentDirsProjectRel, app, enabledAgents, skill]
  );

  const handleProactiveConsolidate = React.useCallback(() => {
    void runProactiveConsolidate({
      app,
      skill,
      agentDirsProjectRel,
    });
  }, [agentDirsProjectRel, app, skill]);

  return (
    <SkillRowLayout
      name={displayName}
      description={skill.description}
      menuOpen={menuOpen}
      annotations={
        <>
          {chips.map((chip) => (
            <Chip key={chip.label} variant={chip.variant} label={chip.label} />
          ))}
          {locationLabel !== null && (
            <span className="tw-truncate tw-text-ui-smaller tw-text-faint">{locationLabel}</span>
          )}
        </>
      }
      controls={
        <div className="tw-flex tw-items-center tw-gap-1.5">
          {agents.map((agent) => {
            const enabled = enabledAgents.has(agent.id);
            return (
              <AgentIconButton
                key={agent.id}
                Icon={agent.Icon}
                agentId={agent.id}
                agentName={agent.displayName}
                enabled={enabled}
                onClick={() => {
                  void handleToggleAgent(agent.id);
                }}
                title={tooltipFor(agent.displayName, enabled)}
              />
            );
          })}
        </div>
      }
      actions={
        // Non-modal: a modal menu can strand Radix's wheel listener after Reveal in vault.
        // https://github.com/logancyang/obsidian-copilot-preview/issues/118
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title="More actions"
              aria-label={`More actions for ${skill.name}`}
            >
              <MoreVertical className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="tw-min-w-[180px]"
            container={containerRef.current}
          >
            {mirroredLockdown ? (
              <MirroredLockdownMenu
                tooltip={lockdownTooltip ?? ""}
                onMigrate={handleProactiveConsolidate}
                onRevealInVault={onRevealInVault}
              />
            ) : (
              <>
                <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onEditSkillMd}>
                  <Edit3 className="tw-size-3.5" aria-hidden="true" />
                  Edit SKILL.md
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-gap-2.5 tw-text-ui-small"
                  onSelect={onEditProperties}
                >
                  <Settings className="tw-size-3.5" aria-hidden="true" />
                  Properties…
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-gap-2.5 tw-text-ui-small"
                  onSelect={onRevealInVault}
                >
                  <FolderSearch className="tw-size-3.5" aria-hidden="true" />
                  Reveal in vault
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-gap-2.5 tw-text-ui-small tw-text-error focus:tw-bg-modifier-error-rgb/15 focus:tw-text-error"
                  onSelect={onDelete}
                >
                  <Trash2 className="tw-size-3.5" aria-hidden="true" />
                  Delete…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
};

interface ChipSpec {
  variant: "default" | "warn" | "solid";
  label: string;
}

function buildLocationLabel(
  skill: Skill,
  agentDirsProjectRel: Readonly<Record<BackendId, string>>
): string | null {
  if (skill.location.kind !== "project") return null;
  const dirs = skill.location.agentDirs;
  if (dirs.length === 0) return null;
  if (dirs.length === 1) {
    const rel = agentDirsProjectRel[dirs[0]];
    return rel !== undefined ? `in ${rel}` : null;
  }
  const parents = dirs
    .map((id) => agentDirsProjectRel[id])
    .filter((p): p is string => typeof p === "string")
    .map(parentDotFolder);
  if (parents.length === 0) return null;
  return `mirrored in ${parents.join(", ")}`;
}

function parentDotFolder(rel: string): string {
  const trimmed = rel.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

function agentDisplayName(agents: ReadonlyArray<AgentBrand>, id: BackendId): string {
  return agents.find((a) => a.id === id)?.displayName ?? id;
}

function computeChips(skill: Skill): ChipSpec[] {
  const chips: ChipSpec[] = [];
  if (skill.disableModelInvocation === true) {
    chips.push({ variant: "warn", label: "model-invoke off" });
  }
  if (skill.userInvocable === false) {
    chips.push({ variant: "default", label: "hidden from /" });
  }
  if (skill.model !== undefined && skill.model.length > 0) {
    chips.push({ variant: "solid", label: `claude · ${truncateModel(skill.model)}` });
  }
  return chips;
}

function truncateModel(model: string): string {
  return model.length <= 22 ? model : `${model.slice(0, 21)}…`;
}

function tooltipFor(agentName: string, enabled: boolean): string {
  return enabled ? `Enabled for ${agentName}` : `Disabled for ${agentName} · click to enable`;
}

const MirroredLockdownMenu: React.FC<{
  tooltip: string;
  onMigrate: () => void;
  onRevealInVault?: () => void;
}> = ({ tooltip, onMigrate, onRevealInVault }) => {
  const mutedClass = cn(
    "tw-cursor-not-allowed tw-gap-2.5 tw-text-ui-small tw-text-faint",
    "data-[highlighted]:tw-bg-transparent data-[highlighted]:tw-text-faint"
  );
  return (
    <TooltipProvider delayDuration={120}>
      <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onMigrate}>
        <Move className="tw-size-3.5" aria-hidden="true" />
        Migrate to shared folder
      </DropdownMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            className={mutedClass}
            aria-disabled="true"
            onSelect={(e) => e.preventDefault()}
          >
            <Edit3 className="tw-size-3.5" aria-hidden="true" />
            Edit SKILL.md
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            className={mutedClass}
            aria-disabled="true"
            onSelect={(e) => e.preventDefault()}
          >
            <Settings className="tw-size-3.5" aria-hidden="true" />
            Properties…
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onRevealInVault}>
        <FolderSearch className="tw-size-3.5" aria-hidden="true" />
        Reveal in vault
      </DropdownMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            className={cn(mutedClass, "tw-text-error/60")}
            aria-disabled="true"
            onSelect={(e) => e.preventDefault()}
          >
            <Trash2 className="tw-size-3.5" aria-hidden="true" />
            Delete…
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const Chip: React.FC<{ variant: ChipSpec["variant"]; label: string }> = ({ variant, label }) => {
  const base = cn(
    "tw-rounded-sm tw-border tw-px-1.5 tw-py-0.5 tw-font-mono tw-text-smallest tw-font-medium tw-uppercase tw-tracking-wide"
  );
  const variantClasses =
    variant === "warn"
      ? "tw-border-dashed tw-border-warning tw-text-warning tw-bg-callout-warning/20"
      : variant === "solid"
        ? "tw-border-solid tw-border-border tw-bg-primary-alt tw-text-normal"
        : "tw-border-dashed tw-border-faint tw-text-muted";
  return <span className={cn(base, variantClasses)}>{label}</span>;
};

interface RunMigrationArgs {
  app: App;
  skill: Skill;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  variant: MigrateConfirmVariant;
  targetAgent: BackendId;
  targetAgentDisplayName: string;
  action: "expandToNewAgent" | "disableLastAgent";
}

function runMigration(args: RunMigrationArgs): Promise<void> {
  const manager = SkillManager.getInstance();
  const canonicalFolderRel = resolveCanonicalSkillsFolderRel();
  let resolvedName: string;
  try {
    resolvedName = manager.resolveCanonicalNameForMigration(args.skill.name);
  } catch (err) {
    new Notice(
      `Could not migrate ${args.skill.name}: ${err instanceof Error ? err.message : String(err)}`
    );
    return Promise.resolve();
  }
  const lines = buildToggleMigrationActionLines({
    skill: args.skill,
    canonicalFolderRel,
    agentDirsProjectRel: args.agentDirsProjectRel,
    targetAgent: args.targetAgent,
    resolvedName,
    variant: args.variant,
  });
  const duplicates = args.skill.location.kind === "project" ? args.skill.location.agentDirs : [];

  const commit = async (suppressFuture: boolean): Promise<void> => {
    if (suppressFuture) manager.setSuppressMigrationConfirm(true);
    const result = await manager.migrateProjectSkillForToggle(
      args.skill,
      args.action === "expandToNewAgent" ? args.targetAgent : null,
      args.action
    );
    if (!result.ok && result.reason !== "eperm") {
      new Notice(`Could not migrate ${args.skill.name}: ${result.reason}`);
      return;
    }
    if (args.action === "expandToNewAgent") {
      new Notice(
        `Moved ${args.skill.name} to ${canonicalFolderRel}/ and enabled ${args.targetAgentDisplayName}.`
      );
    } else {
      new Notice(
        `Moved ${args.skill.name} to ${canonicalFolderRel}/ and disabled ${args.targetAgentDisplayName}.`
      );
    }
  };

  if (manager.getSuppressMigrationConfirm()) {
    return commit(false).catch((err) => {
      logError("Suppressed migration commit failed", err);
    });
  }

  const duplicatePathStrings =
    args.variant === "project-mirrored" || args.variant === "disable-last-agent"
      ? duplicates
          .map((agent) => {
            const dir = args.agentDirsProjectRel[agent];
            return dir === undefined ? null : `<vault>/${dir}/${args.skill.name}/`;
          })
          .filter((p): p is string => p !== null)
      : [];

  new MigrateSkillConfirmModal(args.app, {
    variant: args.variant,
    skill: args.skill,
    targetAgent: args.targetAgent,
    targetAgentDisplayName: args.targetAgentDisplayName,
    resolvedCanonicalName: resolvedName,
    sourceDuplicatePaths: duplicatePathStrings,
    actionLines: lines,
    onConfirm: commit,
  }).open();
  return Promise.resolve();
}

interface RunProactiveConsolidateArgs {
  app: App;
  skill: Skill;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
}

function runProactiveConsolidate(args: RunProactiveConsolidateArgs): Promise<void> {
  if (args.skill.location.kind !== "project" || args.skill.location.agentDirs.length < 2) {
    return Promise.resolve();
  }
  const manager = SkillManager.getInstance();
  const canonicalFolderRel = resolveCanonicalSkillsFolderRel();
  let resolvedName: string;
  try {
    resolvedName = manager.resolveCanonicalNameForMigration(args.skill.name);
  } catch (err) {
    new Notice(
      `Could not consolidate ${args.skill.name}: ${err instanceof Error ? err.message : String(err)}`
    );
    return Promise.resolve();
  }
  const lines = buildConsolidateActionLines({
    skill: args.skill,
    canonicalFolderRel,
    agentDirsProjectRel: args.agentDirsProjectRel,
    resolvedName,
  });
  const duplicatePathStrings = args.skill.location.agentDirs
    .map((agent) => {
      const dir = args.agentDirsProjectRel[agent];
      return dir === undefined ? null : `<vault>/${dir}/${args.skill.name}/`;
    })
    .filter((p): p is string => p !== null);

  const commit = async (suppressFuture: boolean): Promise<void> => {
    const result = await manager.consolidateMirroredSkill(args.skill, suppressFuture);
    if (!result.ok && result.reason !== "eperm") {
      new Notice(`Could not consolidate ${args.skill.name}: ${result.reason}`);
      return;
    }
    new Notice(`Consolidated ${args.skill.name} into ${canonicalFolderRel}/.`);
  };

  if (manager.getSuppressMigrationConfirm()) {
    return commit(false).catch((err) => {
      logError("Suppressed consolidate failed", err);
    });
  }

  new MigrateSkillConfirmModal(args.app, {
    variant: "proactive-consolidate",
    skill: args.skill,
    targetAgent: null,
    resolvedCanonicalName: resolvedName,
    sourceDuplicatePaths: duplicatePathStrings,
    actionLines: lines,
    onConfirm: commit,
  }).open();
  return Promise.resolve();
}

interface BuildLinesArgs {
  skill: Skill;
  canonicalFolderRel: string;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  targetAgent: BackendId;
  resolvedName: string;
  variant: MigrateConfirmVariant;
}

function buildToggleMigrationActionLines(args: BuildLinesArgs): MigrateActionLine[] {
  const { skill, canonicalFolderRel, agentDirsProjectRel, targetAgent, resolvedName, variant } =
    args;
  const out: MigrateActionLine[] = [];
  if (skill.location.kind !== "project") return out;
  const sourceDirs = skill.location.agentDirs;
  const repAgent = sourceDirs[0];
  const repDir = agentDirsProjectRel[repAgent];
  if (repDir === undefined) return out;

  const canonicalDest = `<vault>/${canonicalFolderRel}/${resolvedName}/`;

  out.push({
    verb: "Move",
    detail: `<vault>/${repDir}/${skill.name}/   →   ${canonicalDest}`,
  });

  for (const agent of sourceDirs.slice(1)) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: "Delete",
      detail: `<vault>/${dir}/${skill.name}/`,
      note: "(identical duplicate)",
    });
  }

  if (variant === "disable-last-agent") {
    out.push({
      verb: "Not create",
      detail: "any shortcuts (no agents enabled).",
    });
    return out;
  }

  const finalAgents = sourceDirs.includes(targetAgent) ? sourceDirs : [...sourceDirs, targetAgent];
  for (const agent of finalAgents) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: "Create",
      detail: `<vault>/${dir}/${resolvedName}`,
      note: "(shortcut to the new location)",
    });
  }
  return out;
}

interface BuildConsolidateLinesArgs {
  skill: Skill;
  canonicalFolderRel: string;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  resolvedName: string;
}

function buildConsolidateActionLines(args: BuildConsolidateLinesArgs): MigrateActionLine[] {
  const { skill, canonicalFolderRel, agentDirsProjectRel, resolvedName } = args;
  if (skill.location.kind !== "project") return [];
  const sourceDirs = skill.location.agentDirs;
  const out: MigrateActionLine[] = [];
  const repAgent = sourceDirs[0];
  const repDir = agentDirsProjectRel[repAgent];
  if (repDir === undefined) return [];

  out.push({
    verb: "Move",
    detail: `<vault>/${repDir}/${skill.name}/   →   <vault>/${canonicalFolderRel}/${resolvedName}/`,
  });
  for (const agent of sourceDirs.slice(1)) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: "Delete",
      detail: `<vault>/${dir}/${skill.name}/`,
      note: "(identical duplicate)",
    });
  }
  for (const agent of sourceDirs) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: "Create",
      detail: `<vault>/${dir}/${resolvedName}`,
      note: "(shortcut to the new location)",
    });
  }
  return out;
}

function resolveCanonicalSkillsFolderRel(): string {
  return getEffectiveSkillsFolder();
}
