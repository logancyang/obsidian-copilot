import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Edit3, FolderSearch, MoreVertical, Settings, Trash2 } from "lucide-react";
import React from "react";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { AgentIconButton } from "./AgentIconButton";
import type { Skill } from "@/agentMode/skills/types";

interface SkillRowProps {
  skill: Skill;
  /** Brand projection of every registered backend, supplied by the host. */
  agents: ReadonlyArray<AgentBrand>;
  /**
   * Click handler for an agent toggle. Wired to the symlink
   * lifecycle in `SkillsSettings.tsx`; the optimistic-update pattern lives
   * there so the row stays a pure presentational component.
   */
  onToggleAgent?: (agent: BackendId) => void | Promise<void>;
  /** Open the SKILL.md file in Obsidian's editor. */
  onEditSkillMd?: () => void;
  /** Open the per-skill properties modal. */
  onEditProperties?: () => void;
  /** Reveal the canonical skill folder in the file explorer. */
  onRevealInVault?: () => void;
  /** Open the delete-confirmation dialog. */
  onDelete?: () => void;
  /**
   * DOM container for the overflow menu's Radix portal. Must point to a node
   * inside Obsidian's Settings modal so the menu lives in the modal's focus
   * scope — otherwise Radix's focus-follows-hover fails (focus calls don't
   * land on the menu items) and the existing `focus:` highlight styles never
   * apply, making the menu look dead on mouseover.
   */
  containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Single row in the Tidy list — name + chips + description on the left,
 * three brand-coloured agent toggles in the middle, ⋯ overflow on the right.
 * Visual contract mirrors `Skills Tab Flows.html` §D + §E.
 */
export const SkillRow: React.FC<SkillRowProps> = ({
  skill,
  agents,
  onToggleAgent,
  onEditSkillMd,
  onEditProperties,
  onRevealInVault,
  onDelete,
  containerRef,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const chips = computeChips(skill);
  const enabledAgents = new Set(skill.enabledAgents);
  // Codex silently ignores the three Claude-only flags. We surface this by
  // hard-disabling the Codex toggle when any of those flags are set so the
  // user understands the row is Claude-only territory.
  const claudeOnlySkill = isClaudeOnlySkill(skill);

  return (
    <div
      data-menu-open={menuOpen ? "true" : undefined}
      className={cn(
        "tw-grid tw-grid-cols-[1fr_auto_auto] tw-items-center tw-gap-4",
        "tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary",
        "tw-px-3.5 tw-py-2.5",
        "tw-transition-colors hover:tw-border-border-hover hover:tw-bg-primary-alt",
        "data-[menu-open=true]:tw-bg-primary-alt data-[menu-open=true]:tw-border-normal/100"
      )}
    >
      {/* Name + description column */}
      <div className="tw-min-w-0">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-[14px] tw-font-semibold tw-text-normal">{skill.name}</span>
          {chips.map((chip) => (
            <Chip key={chip.label} variant={chip.variant} label={chip.label} />
          ))}
        </div>
        {skill.description.length > 0 && (
          <div className="tw-mt-0.5 tw-max-w-[540px] tw-truncate tw-text-[12.5px] tw-text-muted">
            {skill.description}
          </div>
        )}
      </div>

      {/* Agent toggle row */}
      <div className="tw-flex tw-items-center tw-gap-1.5">
        {agents.map((agent) => {
          const enabled = enabledAgents.has(agent.id);
          // Codex silently ignores the Claude-only frontmatter flags
          // (`disable-model-invocation`, explicit `model:`, `user-invocable:
          // false`). When those flags are set we hard-disable the Codex toggle
          // to communicate that the row is Claude-only territory. Other
          // backends are unaffected.
          const hardDisabled = agent.id === "codex" && claudeOnlySkill;
          return (
            <AgentIconButton
              key={agent.id}
              Icon={agent.Icon}
              agentId={agent.id}
              agentName={agent.displayName}
              enabled={enabled}
              disabled={hardDisabled}
              onClick={
                onToggleAgent !== undefined && !hardDisabled
                  ? () => {
                      void onToggleAgent(agent.id);
                    }
                  : undefined
              }
              title={tooltipFor(agent.displayName, enabled, hardDisabled)}
            />
          );
        })}
      </div>

      {/* Overflow popover — Edit / Properties / Reveal / Delete */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
          <DropdownMenuItem className="tw-gap-2.5 tw-text-[13px]" onSelect={onEditSkillMd}>
            <Edit3 className="tw-size-3.5" aria-hidden="true" />
            Edit SKILL.md
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-[13px]" onSelect={onEditProperties}>
            <Settings className="tw-size-3.5" aria-hidden="true" />
            Properties…
          </DropdownMenuItem>
          <DropdownMenuItem className="tw-gap-2.5 tw-text-[13px]" onSelect={onRevealInVault}>
            <FolderSearch className="tw-size-3.5" aria-hidden="true" />
            Reveal in vault
          </DropdownMenuItem>
          <DropdownMenuItem
            className="tw-gap-2.5 tw-text-[13px] tw-text-error focus:tw-bg-modifier-error-rgb/15 focus:tw-text-error"
            onSelect={onDelete}
          >
            <Trash2 className="tw-size-3.5" aria-hidden="true" />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

interface ChipSpec {
  variant: "default" | "warn" | "solid";
  label: string;
}

/**
 * Translate Claude-only frontmatter flags into the small inline chips
 * shown next to the skill name. Order is meaningful — warnings come
 * before informational chips.
 */
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

/** Trim model strings down so the chip stays single-line in narrow panels. */
function truncateModel(model: string): string {
  return model.length <= 22 ? model : `${model.slice(0, 21)}…`;
}

/**
 * A skill is "Claude-only" if any of the three Claude-native flags are set
 * — Codex and (for `user-invocable`) OpenCode silently ignore them. We
 * only surface this state on the Codex toggle.
 */
function isClaudeOnlySkill(skill: Skill): boolean {
  return (
    skill.model !== undefined ||
    skill.disableModelInvocation === true ||
    skill.userInvocable === false
  );
}

/** Tooltip copy for a single agent icon in its current state. */
function tooltipFor(agentName: string, enabled: boolean, disabled: boolean): string {
  if (disabled) {
    return `${agentName} ignores this skill's Claude-only flag`;
  }
  return enabled ? `Enabled for ${agentName}` : `Disabled for ${agentName} · click to enable`;
}

/** Inline "model-invoke off" / "hidden from /" / "claude · sonnet-4" pill. */
const Chip: React.FC<{ variant: ChipSpec["variant"]; label: string }> = ({ variant, label }) => {
  const base =
    "tw-px-1.5 tw-py-0.5 tw-rounded-sm tw-font-mono tw-text-[9.5px] tw-tracking-wide tw-uppercase tw-font-medium tw-border";
  const variantClasses =
    variant === "warn"
      ? "tw-border-dashed tw-border-warning tw-text-warning tw-bg-callout-warning/20"
      : variant === "solid"
        ? "tw-border-solid tw-border-border tw-bg-primary-alt tw-text-normal"
        : "tw-border-dashed tw-border-faint tw-text-muted";
  return <span className={cn(base, variantClasses)}>{label}</span>;
};
