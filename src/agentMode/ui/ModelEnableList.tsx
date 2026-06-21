import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FreeModelWarningIcon } from "@/components/ui/FreeModelWarningIcon";
import { ModelCapabilityIcons, hasCapabilityIcons } from "@/components/ui/model-display";
import { SearchBar } from "@/components/ui/SearchBar";
import { SettingSwitch } from "@/components/ui/setting-switch";
import type { ModelCapability } from "@/constants";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import React from "react";

/** A single toggleable model row. */
export interface ModelEnableRow {
  /** Stable identity used for the toggle callback (a `configuredModelId`). */
  id: string;
  /** Primary label shown to the user. */
  label: string;
  /** Optional secondary line — the model's capability blurb. */
  description?: string;
  /** Wire id, matched by search but never rendered (it duplicates the label). */
  wireId?: string;
  /** Whether the model is currently enabled. */
  enabled: boolean;
  /** Modality icons (vision/websearch) shown beside the label; reasoning is not rendered. */
  capabilities?: ModelCapability[];
  /**
   * `true` for a free model (zero catalog cost) routed through a third party.
   * Renders a privacy-warning icon + tooltip beside the label, since such
   * providers may retain or train on prompts. Self-hosted / local models
   * (Ollama, LM Studio) are excluded.
   */
  isFree?: boolean;
}

/** A provider-display-name-grouped section of model rows. */
export interface ModelEnableGroup {
  /** Stable key used for React keys. */
  key: string;
  /** Group heading — a provider display name (no glyphs/avatars). */
  label: string;
  /**
   * Origin badge (e.g. "BYOK", "Agent Provided"). Set only when the list spans
   * multiple origins, so it actually disambiguates. Copilot Plus carries no
   * badge — its label already reads "Copilot Plus".
   */
  badge?: string;
  /**
   * Visually emphasize the group header (accent color). Set for Copilot Plus,
   * which the caller also floats to the top of the list.
   */
  highlight?: boolean;
  rows: ModelEnableRow[];
}

interface ModelEnableListProps {
  /** Provider-grouped rows to render. Already filtered/derived by the caller. */
  groups: ModelEnableGroup[];
  /** Toggle handler — `enabled` is the next desired state. */
  onToggle: (id: string, enabled: boolean) => void;
  /** Search query (controlled). */
  query: string;
  onQueryChange: (next: string) => void;
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
  /** Rendered when there are no groups/rows to show (after filtering). */
  emptyState?: React.ReactNode;
}

/**
 * Presentational toggle list for agent model curation: provider-grouped rows, a
 * search box, and a switch per row. Owns no registry/atom access — the container
 * passes grouped data and `onToggle`. Group headings show the provider display
 * name only (no glyphs/avatars).
 */
export const ModelEnableList: React.FC<ModelEnableListProps> = ({
  groups,
  onToggle,
  query,
  onQueryChange,
  searchPlaceholder = "Search models…",
  emptyState,
}) => {
  const searching = query.trim().length > 0;

  // Open by default — track only the keys the user explicitly collapsed. While
  // searching, force every group open so matches are never hidden; the collapse
  // intent is remembered and re-applies once the query clears.
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const isOpen = (key: string) => searching || !collapsed[key];
  const handleOpenChange = (key: string, open: boolean) =>
    setCollapsed((prev) => ({ ...prev, [key]: !open }));

  const renderRows = (rows: ModelEnableRow[]): React.ReactNode => (
    <div className="tw-space-y-1">
      {rows.map((row) => (
        <div
          key={row.id}
          className={cn(
            "tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded tw-px-2 tw-py-1",
            "hover:tw-bg-modifier-hover"
          )}
        >
          <div className="tw-min-w-0">
            <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
              <span className="tw-truncate">{row.label}</span>
              {row.isFree && <FreeModelWarningIcon />}
              {hasCapabilityIcons(row.capabilities) && (
                <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
                  <ModelCapabilityIcons capabilities={row.capabilities} iconSize={14} />
                </span>
              )}
            </div>
            {row.description && (
              <div className="tw-truncate tw-text-xs tw-text-muted">{row.description}</div>
            )}
          </div>
          <SettingSwitch checked={row.enabled} onCheckedChange={(next) => onToggle(row.id, next)} />
        </div>
      ))}
    </div>
  );

  const hasRows = groups.some((g) => g.rows.length > 0);

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <SearchBar value={query} onChange={onQueryChange} placeholder={searchPlaceholder} />

      <div className="tw-max-h-80 tw-overflow-y-auto tw-pr-1">
        {!hasRows ? (
          <div className="tw-py-6 tw-text-center tw-text-sm tw-text-muted">
            {emptyState ?? (searching ? `No models match “${query.trim()}”.` : "No models.")}
          </div>
        ) : (
          <div className="tw-space-y-2">
            {groups
              .filter((g) => g.rows.length > 0)
              .map((group) => (
                <Collapsible
                  key={group.key}
                  open={isOpen(group.key)}
                  onOpenChange={(open) => handleOpenChange(group.key, open)}
                >
                  <CollapsibleTrigger asChild>
                    <div className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-1 tw-rounded tw-px-2 tw-py-1.5 tw-text-left tw-text-ui-medium tw-font-bold hover:tw-bg-modifier-hover">
                      <ChevronRight
                        className={cn(
                          "tw-size-3 tw-shrink-0 tw-text-muted tw-transition-transform",
                          isOpen(group.key) && "tw-rotate-90"
                        )}
                      />
                      <span
                        className={cn(
                          "tw-truncate",
                          group.highlight && "tw-font-bold tw-text-accent"
                        )}
                      >
                        {group.label}
                      </span>
                      {group.badge && (
                        <Badge variant="secondary" className="tw-shrink-0 tw-font-normal">
                          {group.badge}
                        </Badge>
                      )}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="tw-pl-4">{renderRows(group.rows)}</div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
