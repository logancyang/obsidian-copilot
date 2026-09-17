import { AgentEditor, type AgentEditorProps } from "@/agents/ui/AgentEditor";
import { AgentRow, type AgentRowItem } from "@/agents/ui/AgentRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Plus, Search, Users } from "lucide-react";
import React from "react";

/** Per-agent callbacks the list rows fan out to, keyed by slug at call time. */
export interface AgentRowActions {
  onSelect: (slug: string) => void;
  onEdit: (slug: string) => void;
  onOpenFolder: (slug: string) => void;
  onOpenMemory: (slug: string) => void;
  onClearMemory: (slug: string) => void;
  onDelete: (slug: string) => void;
}

export interface AgentsSettingsViewProps {
  /** Vault-relative agents folder, shown so the user can find the files. */
  agentsFolder: string;
  /** Every agent on disk, already formatted and ordered. */
  agents: readonly AgentRowItem[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onNewAgent: () => void;
  actions: AgentRowActions;
  /** Slug currently open in the editor, or null while creating or idle. */
  selectedSlug: string | null;
  /** The open editor, or null when no agent is being created or edited. */
  editor: AgentEditorProps | null;
  containerRef?: React.RefObject<HTMLElement>;
}

/**
 * The Agents settings tab: a searchable roster, with the agent being created or
 * edited opened beneath it. Presentational — every value and callback comes from
 * the container, so the gallery can render each state from fixtures.
 */
export const AgentsSettingsView: React.FC<AgentsSettingsViewProps> = ({
  agentsFolder,
  agents,
  searchValue,
  onSearchChange,
  onNewAgent,
  actions,
  selectedSlug,
  editor,
  containerRef,
}) => {
  const query = searchValue.trim().toLowerCase();
  const visible =
    query.length === 0
      ? agents
      : agents.filter((agent) =>
          `${agent.name} ${agent.description}`.toLowerCase().includes(query)
        );

  return (
    <div className="tw-space-y-4">
      <section>
        <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">Agents</div>
          <div className="tw-text-sm tw-text-muted">
            Agents are named personas you talk to one at a time. Each one keeps its own instructions
            and its own memory file as ordinary notes in your vault, so you can read and edit
            everything it knows.
          </div>
        </div>

        {/* Toolbar — search + count + create, matching the Skills tab's row. */}
        <div className="tw-mt-4 tw-flex tw-items-center tw-gap-2">
          <div className="tw-relative tw-flex-1 sm:tw-flex-initial">
            <Search
              className="tw-pointer-events-none tw-absolute tw-left-2.5 tw-top-1/2 tw-size-4 tw--translate-y-1/2 tw-text-faint"
              aria-hidden="true"
            />
            <Input
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search agents…"
              className="!tw-w-full !tw-pl-8 sm:!tw-w-64"
              aria-label="Search agents"
            />
          </div>
          <span className="tw-text-xs tw-text-muted">{agents.length} loaded</span>
          <div className="tw-ml-auto">
            <Button variant="secondary" size="sm" onClick={onNewAgent}>
              <Plus className="tw-size-4" aria-hidden="true" />
              New agent
            </Button>
          </div>
        </div>

        {agents.length === 0 && editor === null ? (
          <div className="tw-mt-4">
            <AgentsEmptyPlaceholder folder={agentsFolder} />
          </div>
        ) : (
          // The roster and the open agent stack rather than sitting side by
          // side: Obsidian caps this panel's width well below what a list plus a
          // 380px editor column needs, and splitting it there squeezes every row
          // down to its first few words.
          <div className="tw-mt-4 tw-flex tw-flex-col tw-gap-4">
            <div role="region" aria-label="Your agents" className="tw-flex tw-flex-col tw-gap-1.5">
              {visible.length === 0 ? (
                <div className="tw-rounded-sm tw-border tw-border-dashed tw-border-border tw-bg-primary tw-px-3 tw-py-6 tw-text-center tw-text-ui-smaller tw-text-muted">
                  {agents.length === 0
                    ? "No agents yet."
                    : `No agents match “${searchValue.trim()}”.`}
                </div>
              ) : (
                visible.map((agent) => (
                  <AgentRow
                    key={agent.slug}
                    agent={agent}
                    selected={agent.slug === selectedSlug}
                    onSelect={() => actions.onSelect(agent.slug)}
                    onEdit={() => actions.onEdit(agent.slug)}
                    onOpenFolder={() => actions.onOpenFolder(agent.slug)}
                    onOpenMemory={() => actions.onOpenMemory(agent.slug)}
                    onClearMemory={() => actions.onClearMemory(agent.slug)}
                    onDelete={() => actions.onDelete(agent.slug)}
                    containerRef={containerRef}
                  />
                ))
              )}
            </div>
            {editor !== null && (
              <div
                role="region"
                aria-label="Agent editor"
                className={cn(
                  "tw-rounded-md tw-border tw-border-solid tw-border-border",
                  "tw-bg-primary tw-p-3.5"
                )}
              >
                <AgentEditor {...editor} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

/**
 * The Agents tab's empty state, mirroring the Skills tab's placeholder so the
 * two sibling tabs read as one surface.
 */
const AgentsEmptyPlaceholder: React.FC<{ folder: string }> = ({ folder }) => (
  <div
    className={cn(
      "tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-2",
      "tw-min-h-[320px] tw-rounded-md tw-border tw-border-dashed tw-border-border",
      "tw-p-12 tw-text-faint"
    )}
  >
    <div
      className={cn(
        "tw-flex tw-items-center tw-justify-center",
        "tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-3"
      )}
    >
      <Users className="tw-size-6 tw-text-faint" aria-hidden="true" />
    </div>
    <div className="tw-text-smaller tw-font-medium tw-text-muted">No agents yet</div>
    <div className="tw-max-w-[420px] tw-text-center tw-text-ui-smaller tw-text-faint">
      Create one and Copilot writes it a folder with an <code>agent.md</code> for its instructions
      and a <code>MEMORY.md</code> it maintains itself. Until then every chat talks to plain
      Copilot.
    </div>
    <div className="tw-mt-3.5 tw-font-mono tw-text-smallest tw-text-faint">
      agents live in · <code>&lt;vault&gt;/{folder}/</code>
    </div>
  </div>
);
