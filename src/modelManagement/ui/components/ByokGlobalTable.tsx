/**
 * Single global table that renders every BYOK provider as a section row
 * with indented model rows beneath it.
 *
 * Model rows are display-only. To edit which models a provider exposes,
 * use the Configure entry in the section's overflow menu. Model metadata
 * (context window, release date) is read from the persisted
 * `ConfiguredModel.info` snapshot — never a live catalog lookup.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModelCapabilityIcons, hasCapabilityIcons } from "@/components/ui/model-display";
import { cn } from "@/lib/utils";
import { capabilitiesFromConfiguredInfo } from "@/modelManagement/chatModel/modelCapabilityFlags";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import {
  formatContextWindow,
  formatReleaseDate,
} from "@/modelManagement/ui/utils/formatModelMetadata";
import { ChevronDown, ChevronRight, MoreVertical, Settings2, Trash2 } from "lucide-react";
import React, { useRef, useState } from "react";

/** One provider plus the configured models that belong to it. */
export interface ByokTableGroup {
  provider: Provider;
  models: ConfiguredModel[];
}

interface ByokGlobalTableProps {
  groups: readonly ByokTableGroup[];
  /** "Configure" picked from the section's overflow menu. */
  onConfigure: (providerId: string) => void;
  /** "Remove provider" picked from the section's overflow menu. */
  onRemove: (providerId: string) => void;
  /** Shown when `groups` is empty. Defaults to the no-providers prompt;
   *  callers pass a search-specific message when a filter is active. */
  emptyMessage?: React.ReactNode;
}

/**
 * `ByokGlobalTable` — a single CSS-grid "table" so model rows can sit
 * underneath provider section rows in the same column layout.
 */
export const ByokGlobalTable: React.FC<ByokGlobalTableProps> = ({
  groups,
  onConfigure,
  onRemove,
  emptyMessage,
}) => {
  // Per-row collapse state, defaulting to open. Local only — no global tracking.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Portal target for the per-row DropdownMenuContent. Without this, Radix
  // portals into `activeDocument.body` — outside the settings modal —
  // where pointer events don't reach the menu items.
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = (providerId: string): void =>
    setCollapsed((prev) => ({ ...prev, [providerId]: !prev[providerId] }));

  if (groups.length === 0) {
    return (
      <div
        className={cn(
          "tw-flex tw-flex-col tw-items-center tw-justify-center",
          "tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-6",
          "tw-text-center tw-text-sm tw-text-muted"
        )}
        data-testid="byok-table-empty"
      >
        {emptyMessage ?? "No providers yet — click + Add a provider to start."}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "tw-flex tw-w-full tw-flex-col tw-overflow-hidden",
        "tw-rounded-md tw-border tw-border-solid tw-border-border"
      )}
      role="table"
    >
      <div>
        {groups.map((group, idx) => (
          <React.Fragment key={group.provider.providerId}>
            {idx > 0 && <div role="separator" className="tw-h-px tw-bg-primary-alt" />}
            <ProviderSection
              group={group}
              isOpen={!collapsed[group.provider.providerId]}
              onToggle={() => toggle(group.provider.providerId)}
              onConfigure={() => onConfigure(group.provider.providerId)}
              onRemove={() => onRemove(group.provider.providerId)}
              containerRef={containerRef}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

interface ProviderSectionProps {
  group: ByokTableGroup;
  isOpen: boolean;
  onToggle: () => void;
  onConfigure: () => void;
  onRemove: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

const ProviderSection: React.FC<ProviderSectionProps> = ({
  group,
  isOpen,
  onToggle,
  onConfigure,
  onRemove,
  containerRef,
}) => {
  const { provider, models } = group;
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <div role="rowgroup">
      <div
        role="row"
        className={cn(
          "tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 tw-text-sm",
          "tw-cursor-pointer hover:tw-bg-primary-alt/50"
        )}
        onClick={onToggle}
        data-testid={`byok-section-${provider.providerId}`}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-expanded={isOpen}
          aria-label={
            isOpen ? `Collapse ${provider.displayName}` : `Expand ${provider.displayName}`
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <Chevron className="tw-size-4" />
        </Button>
        <span className="tw-font-medium tw-text-normal">{provider.displayName}</span>
        <span className="tw-flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => e.stopPropagation()}
              aria-label={`More actions for ${provider.displayName}`}
            >
              <MoreVertical className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" container={containerRef.current}>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onConfigure();
              }}
            >
              <Settings2 className="tw-mr-2 tw-size-4" />
              Configure
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="tw-text-error"
            >
              <Trash2 className="tw-mr-2 tw-size-4" />
              Remove provider
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isOpen && models.map((model) => <ModelRow key={model.configuredModelId} model={model} />)}
    </div>
  );
};

const ModelRow: React.FC<{ model: ConfiguredModel }> = ({ model }) => {
  const contextLabel = formatContextWindow(model.info.limits?.context);
  const releaseLabel = formatReleaseDate(model.info.releaseDate);
  const capabilities = capabilitiesFromConfiguredInfo(model.info);
  return (
    <div
      role="row"
      data-testid={`byok-model-${model.configuredModelId}`}
      className={cn(
        "tw-grid tw-grid-cols-[1fr_auto_auto] tw-items-center tw-gap-3",
        "tw-px-3 tw-pb-3 tw-pl-12 tw-pt-1.5 tw-text-sm"
      )}
    >
      <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
        <span className="tw-truncate tw-text-normal">{model.info.displayName}</span>
        {model.info.isEmbedding && (
          <Badge variant="secondary" className="tw-shrink-0 tw-text-ui-smaller">
            Embedding
          </Badge>
        )}
        {hasCapabilityIcons(capabilities) && (
          <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
            <ModelCapabilityIcons capabilities={capabilities} iconSize={14} />
          </span>
        )}
      </div>
      <span className="tw-shrink-0 tw-text-xs tw-text-muted">{contextLabel}</span>
      <span className="tw-w-20 tw-shrink-0 tw-text-right tw-text-xs tw-text-muted">
        {releaseLabel}
      </span>
    </div>
  );
};
