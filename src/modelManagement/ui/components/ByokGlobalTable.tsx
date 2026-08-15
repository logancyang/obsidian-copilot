/**
 * Single global table that renders every BYOK provider as a collapsible
 * accordion card with model rows beneath it.
 *
 * Each provider is a collapsible card (default collapsed). The header shows
 * chevron, provider name, model count, status badge, and overflow menu. When
 * expanded, model names appear in a vertical list with hover × remove.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SelfHostCloudWarningIcon } from "@/components/ui/SelfHostCloudWarningIcon";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import { useModelManagement } from "@/modelManagement/ui/ModelManagementContext";
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { ChevronRight, MoreVertical, Settings2, Trash2, XIcon } from "lucide-react";
import { Notice } from "obsidian";
import React, { useRef, useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

/** One provider plus the configured models that belong to it. */
export interface ByokTableGroup {
  provider: Provider;
  models: ConfiguredModel[];
  /** `true` when Self-Host Mode is on and this is a cloud provider — the card
   *  header shows a cloud-egress warning icon. */
  needsSelfHostWarning?: boolean;
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
 * `ByokGlobalTable` — accordion of provider cards, each collapsible.
 */
export const ByokGlobalTable: React.FC<ByokGlobalTableProps> = ({
  groups,
  onConfigure,
  onRemove,
  emptyMessage,
}) => {
  // Portal target for the per-row DropdownMenuContent. Without this, Radix
  // portals into `activeDocument.body` — outside the settings modal —
  // where pointer events don't reach the menu items.
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div ref={containerRef} className="tw-flex tw-w-full tw-flex-col tw-gap-3" role="list">
      {groups.map((group) => (
        <ProviderCard
          key={group.provider.providerId}
          group={group}
          onConfigure={() => onConfigure(group.provider.providerId)}
          onRemove={() => onRemove(group.provider.providerId)}
          containerRef={containerRef}
        />
      ))}
    </div>
  );
};

interface ProviderCardProps {
  group: ByokTableGroup;
  onConfigure: () => void;
  onRemove: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  group,
  onConfigure,
  onRemove,
  containerRef,
}) => {
  const { provider, models } = group;
  const [isOpen, setIsOpen] = useState(false);
  const api = useModelManagement();
  const app = useApp();

  const getStatusBadge = (): {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    /** Green tint for the "configured" states (key set / local running);
     *  matches the repo's canonical success pill. `undefined` keeps the
     *  neutral variant styling for the "No key" state. */
    className?: string;
  } => {
    const requiresKey = providerRequiresApiKey(provider);
    const successClassName = "tw-rounded-full tw-bg-success tw-text-success";
    if (!requiresKey) {
      return { label: "Running", variant: "default", className: successClassName };
    }
    if (provider.apiKeyKeychainId) {
      return { label: "API key set", variant: "default", className: successClassName };
    }
    return { label: "No key", variant: "secondary", className: "tw-rounded-full" };
  };

  const handleRemoveModel = async (configuredModelId: string, modelName: string): Promise<void> => {
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeConfiguredModel(configuredModelId);
        } catch (err) {
          logError("[ByokGlobalTable] removeConfiguredModel failed", err);
          new Notice("Failed to remove model.");
        }
      },
      `Remove ${modelName} from ${provider.displayName}?`,
      "Remove model",
      "Remove",
      "Cancel"
    );
    modal.open();
  };

  const statusBadge = getStatusBadge();

  // Sub-line under the provider name. Local providers describe themselves
  // (their models aren't a curated count); key-based providers show the
  // configured-model count, with a clearer phrasing for the empty case than
  // a bare "0 models".
  const getSubLine = (): string => {
    if (!providerRequiresApiKey(provider)) {
      return "Local models on your machine";
    }
    if (models.length === 0) {
      return "No models added";
    }
    return `${models.length} ${models.length === 1 ? "model" : "models"}`;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary",
          "tw-overflow-hidden"
        )}
        role="listitem"
        data-testid={`byok-provider-${provider.providerId}`}
      >
        <CollapsibleTrigger asChild>
          <div
            // role/tabIndex/onKeyDown make the header keyboard-operable: a bare
            // clickable div is mouse-only. A real <button> can't be used here
            // because the overflow-menu trigger button is nested inside.
            role="button"
            tabIndex={0}
            aria-expanded={isOpen}
            className={cn(
              "tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-p-3",
              "tw-transition-colors hover:tw-bg-modifier-hover",
              "focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
            )}
            onClick={() => setIsOpen(!isOpen)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsOpen(!isOpen);
              }
            }}
          >
            <ChevronRight
              className={cn(
                "tw-size-4 tw-shrink-0 tw-text-muted tw-transition-transform tw-duration-200",
                isOpen && "tw-rotate-90"
              )}
              aria-hidden="true"
            />
            <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-0.5">
              <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                <span className="tw-truncate tw-text-sm tw-font-semibold tw-text-normal">
                  {provider.displayName}
                </span>
                {group.needsSelfHostWarning && <SelfHostCloudWarningIcon />}
              </span>
              <span className="tw-text-xs tw-text-muted">{getSubLine()}</span>
            </div>
            <div className="tw-flex-1" />
            <Badge
              variant={statusBadge.variant}
              className={cn("tw-shrink-0", statusBadge.className)}
            >
              {statusBadge.label}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`More actions for ${provider.displayName}`}
                  className="tw-shrink-0"
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
                  Edit key
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  className="tw-text-error"
                >
                  <Trash2 className="tw-mr-2 tw-size-4" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="tw-overflow-hidden tw-transition-all tw-duration-200 data-[state=open]:tw-animate-in data-[state=closed]:tw-animate-out data-[state=closed]:tw-fade-out-0 data-[state=open]:tw-fade-in-0 data-[state=closed]:tw-slide-out-to-top-1 data-[state=open]:tw-slide-in-from-top-1">
          {models.length > 0 && (
            <div className="tw-flex tw-flex-col tw-pb-2">
              {models.map((model) => (
                <ModelRow
                  key={model.configuredModelId}
                  model={model}
                  onRemove={safeAsyncHandler(() =>
                    handleRemoveModel(model.configuredModelId, model.info.displayName)
                  )}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

const ModelRow: React.FC<{ model: ConfiguredModel; onRemove: () => void }> = ({
  model,
  onRemove,
}) => {
  return (
    <div
      role="listitem"
      data-testid={`byok-model-${model.configuredModelId}`}
      className={cn(
        "tw-group tw-relative tw-flex tw-items-center tw-gap-2",
        "tw-px-3 tw-py-1.5 tw-pl-10 tw-text-sm tw-text-normal",
        "tw-transition-colors hover:tw-bg-modifier-hover"
      )}
    >
      <span className="tw-flex-1 tw-truncate">{model.info.displayName}</span>
      {/* Mirrors the context-manager modal's remove × (XIcon, size-4,
          group-hover reveal, warning-on-hover) but stays a real focusable
          Button so keyboard users can Tab to it. focus-visible keeps it
          revealed when reached without a pointer. */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "tw-size-6 tw-shrink-0 tw-text-muted hover:tw-text-warning",
          "tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100",
          "focus-visible:tw-opacity-100 focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${model.info.displayName}`}
        tabIndex={0}
      >
        <XIcon className="tw-size-4" />
      </Button>
    </div>
  );
};
