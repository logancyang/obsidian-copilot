import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, CircleOff, Eye, MoreVertical, Power } from "lucide-react";
import { AgentIconButton } from "./AgentIconButton";
import { SkillRowLayout } from "./SkillRowLayout";

export interface BuiltinSkillRow {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  enabledAgents: readonly BackendId[];
  unavailableReason?: string;
}

export interface BuiltinSkillsTableProps {
  skills: readonly BuiltinSkillRow[];
  agents: readonly AgentBrand[];
  availableAgents: readonly BackendId[];
  pending: boolean;
  error?: string;
  onToggleSkill: (name: string, enabled: boolean) => void;
  onToggleAgent: (name: string, agent: BackendId, enabled: boolean) => void;
}

/** Read-only bundled content with independent whole-skill and agent preferences. */
export function BuiltinSkillsTable({
  skills,
  agents,
  availableAgents,
  pending,
  error,
  onToggleSkill,
  onToggleAgent,
}: BuiltinSkillsTableProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [menuName, setMenuName] = React.useState<string>();
  const [previewName, setPreviewName] = React.useState<string>();
  return (
    <section aria-label="Built-in Skills" className="tw-space-y-3">
      <div role="heading" aria-level={3} className="tw-text-left tw-text-base tw-font-semibold">
        Built-in Skills
      </div>
      {error && (
        <div role="alert" className="tw-text-ui-smaller tw-text-error">
          {error}
        </div>
      )}
      <div ref={containerRef} role="table" aria-label="Built-in Skills" className="tw-space-y-1.5">
        {skills.map((skill) => (
          <div role="row" key={skill.name}>
            <SkillRowLayout
              name={skill.name}
              description={skill.description}
              menuOpen={menuName === skill.name}
              annotations={
                <>
                  {/* Whole-skill opt-outs need a visible label, beyond dimmed agent buttons.
                      https://github.com/logancyang/obsidian-copilot/issues/3022 */}
                  {!skill.enabled && (
                    <>
                      <Badge
                        variant="secondary"
                        className="tw-hidden tw-shrink-0 @[140px]/skill-title:tw-inline-flex"
                      >
                        Disabled
                      </Badge>
                      <span
                        title="Disabled"
                        aria-label="Disabled"
                        className="tw-shrink-0 @[140px]/skill-title:tw-hidden"
                      >
                        <CircleOff aria-hidden="true" className="tw-size-3.5 tw-text-muted" />
                      </span>
                    </>
                  )}
                  {skill.unavailableReason && (
                    <span title={skill.unavailableReason} aria-label={skill.unavailableReason}>
                      <AlertTriangle className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
                    </span>
                  )}
                </>
              }
              controls={
                <div className="tw-flex tw-items-center tw-gap-1.5">
                  {agents.map((agent) => {
                    // https://github.com/logancyang/obsidian-copilot/issues/3022
                    // Unconfigured agents must never appear enabled by a bundled default.
                    const available = availableAgents.includes(agent.id);
                    const enabled =
                      skill.enabled &&
                      available &&
                      !skill.unavailableReason &&
                      skill.enabledAgents.includes(agent.id);
                    return (
                      <AgentIconButton
                        key={agent.id}
                        Icon={agent.Icon}
                        agentId={agent.id}
                        agentName={agent.displayName}
                        enabled={!!enabled}
                        disabled={
                          pending || !skill.enabled || !available || !!skill.unavailableReason
                        }
                        title={
                          !available
                            ? `Set up ${agent.displayName} to enable`
                            : `${skill.name} for ${agent.displayName}`
                        }
                        onClick={() => onToggleAgent(skill.name, agent.id, !enabled)}
                      />
                    );
                  })}
                </div>
              }
              actions={
                <DropdownMenu
                  modal={false}
                  open={menuName === skill.name}
                  onOpenChange={(open) => setMenuName(open ? skill.name : undefined)}
                >
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
                  <DropdownMenuContent align="end" container={containerRef.current}>
                    <DropdownMenuItem
                      disabled={pending}
                      className="tw-gap-2.5 tw-text-ui-small"
                      onSelect={() => onToggleSkill(skill.name, !skill.enabled)}
                    >
                      <Power className="tw-size-3.5" />
                      {skill.enabled ? "Disable skill" : "Enable skill"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="tw-gap-2.5 tw-text-ui-small"
                      onSelect={() =>
                        setPreviewName(previewName === skill.name ? undefined : skill.name)
                      }
                    >
                      <Eye className="tw-size-3.5" />
                      View SKILL.md (read-only)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
            {previewName === skill.name && (
              <pre
                aria-label={`${skill.name} content (read-only)`}
                className="tw-max-h-80 tw-overflow-auto tw-whitespace-pre-wrap tw-break-all tw-rounded-md tw-bg-secondary tw-p-3 tw-text-ui-smaller"
              >
                {skill.content}
              </pre>
            )}
          </div>
        ))}
        {skills.length === 0 && (
          <p className="tw-text-ui-smaller tw-text-muted">No built-in skills match your search.</p>
        )}
      </div>
    </section>
  );
}
