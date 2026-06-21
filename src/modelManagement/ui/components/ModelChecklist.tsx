/**
 * `ModelChecklist` — unified model picker used by the BYOK configure
 * dialog for every provider (catalog-backed or self-hosted alike).
 *
 * The dialog assembles the candidate pool from:
 *   - models fetched live from the provider endpoint
 *   - manually-typed ids
 *   - existing configured models (edit mode)
 *
 * Each id is rendered with whatever `ModelInfo` metadata is available
 * — context window, release date, embedding badge — or id-only when
 * the catalog has nothing to add. Selection lives in the parent.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ModelCapabilityIcons, hasCapabilityIcons } from "@/components/ui/model-display";
import { cn } from "@/lib/utils";
import { capabilitiesFromConfiguredInfo } from "@/modelManagement/chatModel/modelCapabilityFlags";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import {
  formatContextWindow,
  formatReleaseDate,
} from "@/modelManagement/ui/utils/formatModelMetadata";
import { orderCatalogModels } from "@/modelManagement/ui/utils/orderCatalogModels";
import { Loader2, X, XCircle } from "lucide-react";
import React, { useMemo, useState } from "react";

export interface ModelChecklistProps {
  /** Merged candidate pool — caller-owned union of fetched, manual,
   *  and existing ids, each carrying its richest known `ModelInfo`. */
  availableModels: readonly ModelInfo[];
  /** Wire ids currently checked. */
  selected: ReadonlySet<string>;
  onToggle: (id: string, next: boolean) => void;
  /** Manual-add input — always visible. */
  onAddId: (id: string) => void;
  /** Remove an id from the candidate pool. The X button only renders
   *  for ids the parent marked as custom-added (see `customIds`);
   *  discovered ids (catalog or live-fetched) would just reappear and
   *  so are non-removable. */
  onRemoveId?: (id: string) => void;
  /** Case-insensitive substring filter over name + id. */
  query?: string;
  /** Placeholder for the manual-add input. */
  modelInputHint?: string;
  /** Spinner shown above the list while the dialog auto-fetches. */
  fetching?: boolean;
  /** Inline error from the most recent fetch, if any. */
  fetchError?: string | null;
  /** Ids the parent considers custom-added (user-typed). Drives both
   *  the X-button visibility and a sort tier that floats these rows
   *  above discovered ones within each selection group. */
  customIds?: ReadonlySet<string>;
}

export const ModelChecklist: React.FC<ModelChecklistProps> = ({
  availableModels,
  selected,
  onToggle,
  onAddId,
  onRemoveId,
  query,
  modelInputHint,
  fetching,
  fetchError,
  customIds,
}) => {
  const [manualId, setManualId] = useState("");

  const filtered = useMemo<readonly ModelInfo[]>(() => {
    const needle = query?.trim().toLowerCase();
    const all = needle
      ? availableModels.filter(
          (m) => m.displayName.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle)
        )
      : availableModels;
    return orderCatalogModels(all, selected, customIds);
  }, [availableModels, query, selected, customIds]);

  const checkedCount = filtered.reduce((n, m) => (selected.has(m.id) ? n + 1 : n), 0);

  const handleManualAdd = (): void => {
    const id = manualId.trim();
    if (!id) return;
    onAddId(id);
    setManualId("");
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {fetching && (
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
          <Loader2 className="tw-size-3.5 tw-shrink-0 tw-animate-spin" />
          <span>Loading models…</span>
        </div>
      )}

      {fetchError && (
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-error">
          <XCircle className="tw-size-3.5 tw-shrink-0" />
          <span>{fetchError}</span>
        </div>
      )}

      {filtered.length > 0 ? (
        <div
          className={cn(
            "tw-flex tw-max-h-[50vh] tw-flex-col tw-overflow-y-auto tw-rounded-md",
            "tw-border tw-border-solid tw-border-border"
          )}
          role="list"
          data-testid="model-checklist"
        >
          {filtered.map((model, index) => {
            const checked = selected.has(model.id);
            const contextLabel = formatContextWindow(model.limits?.context);
            const releaseLabel = formatReleaseDate(model.releaseDate);
            const isLastChecked = index === checkedCount - 1 && checkedCount < filtered.length;
            const removable = onRemoveId !== undefined && customIds?.has(model.id) === true;
            const capabilities = capabilitiesFromConfiguredInfo(model);
            return (
              <label
                key={model.id}
                role="listitem"
                data-testid={`model-row-${model.id}`}
                className={cn(
                  "tw-group tw-grid tw-cursor-pointer tw-items-center tw-gap-3 tw-px-3 tw-py-1.5 tw-text-sm",
                  "hover:tw-bg-primary-alt/40",
                  removable
                    ? "tw-grid-cols-[auto_1fr_auto_auto_auto]"
                    : "tw-grid-cols-[auto_1fr_auto_auto]",
                  isLastChecked && "copilot-divider-b"
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => onToggle(model.id, next === true)}
                />
                <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                  <span className="tw-truncate tw-text-normal">{model.displayName}</span>
                  {model.isEmbedding && (
                    <Badge variant="secondary" className="tw-shrink-0 tw-text-ui-smaller">
                      Embedding
                    </Badge>
                  )}
                  {hasCapabilityIcons(capabilities) && (
                    <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
                      <ModelCapabilityIcons capabilities={capabilities} iconSize={14} />
                    </span>
                  )}
                </span>
                <span className="tw-shrink-0 tw-text-xs tw-text-muted">{contextLabel}</span>
                <span className="tw-w-20 tw-shrink-0 tw-text-right tw-text-xs tw-text-muted">
                  {releaseLabel}
                </span>
                {removable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${model.id}`}
                    data-testid={`model-row-remove-${model.id}`}
                    onClick={(e) => {
                      // The row is a <label>, so a bare click would toggle the
                      // checkbox — suppress that and only remove.
                      e.preventDefault();
                      e.stopPropagation();
                      onRemoveId(model.id);
                    }}
                  >
                    <X className="tw-size-4" />
                  </Button>
                )}
              </label>
            );
          })}
        </div>
      ) : (
        <div
          className={cn(
            "tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-4",
            "tw-text-center tw-text-sm tw-text-muted"
          )}
          data-testid="model-checklist-empty"
        >
          {fetching
            ? "Loading models…"
            : query?.trim()
              ? "No models match the current filters."
              : "No models yet — type an id below or test your credentials to fetch the list."}
        </div>
      )}

      <div className="tw-flex tw-gap-2">
        <Input
          className="tw-flex-1"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleManualAdd();
            }
          }}
          placeholder={modelInputHint ?? "Add a model id"}
          data-testid="model-checklist-manual-input"
        />
        <Button variant="secondary" onClick={handleManualAdd} disabled={!manualId.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
};
