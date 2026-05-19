import { AgentModelCatalogModal } from "@/agentMode/ui/AgentModelCatalogModal";
import { Button } from "@/components/ui/button";
import { isAgentModelEnabled, writeAgentModelOverride } from "@/agentMode/session/modelEnable";
import type { BackendDescriptor, ModelEntry } from "@/agentMode/session/types";
import { usePlugin } from "@/contexts/PluginContext";
import { Plus, X } from "lucide-react";
import React from "react";

interface SelectedModelsListProps {
  descriptor: BackendDescriptor;
  availableModels: ReadonlyArray<ModelEntry>;
  overrides: Record<string, boolean> | undefined;
}

interface SelectedRow {
  baseModelId: string;
  name: string;
  description?: string;
  /** True when the catalog no longer reports this model. */
  unavailable: boolean;
}

/**
 * Compute the rows to display: every catalog entry that resolves to
 * enabled, plus any override-enabled id missing from the catalog
 * (surfaced with an "unavailable" flag so the user can see and remove
 * stale picks).
 */
function computeSelected(
  descriptor: BackendDescriptor,
  availableModels: ReadonlyArray<ModelEntry>,
  overrides: Record<string, boolean> | undefined
): SelectedRow[] {
  const seen = new Set<string>();
  const rows: SelectedRow[] = [];

  for (const entry of availableModels) {
    const enabled = isAgentModelEnabled(
      descriptor,
      { modelId: entry.baseModelId, name: entry.name },
      overrides
    );
    if (!enabled) continue;
    seen.add(entry.baseModelId);
    rows.push({
      baseModelId: entry.baseModelId,
      name: entry.name || entry.baseModelId,
      description: entry.description,
      unavailable: false,
    });
  }

  if (overrides) {
    for (const [id, value] of Object.entries(overrides)) {
      if (!value) continue;
      if (seen.has(id)) continue;
      rows.push({
        baseModelId: id,
        name: id,
        unavailable: true,
      });
    }
  }

  return rows;
}

/**
 * Curation surface for a backend's enabled model set. Replaces the long
 * toggle list — by default only the user's currently-enabled models are
 * visible; the full catalog is one click away in `AgentModelCatalogModal`.
 */
export const SelectedModelsList: React.FC<SelectedModelsListProps> = ({
  descriptor,
  availableModels,
  overrides,
}) => {
  const plugin = usePlugin();
  const rows = React.useMemo(
    () => computeSelected(descriptor, availableModels, overrides),
    [descriptor, availableModels, overrides]
  );

  const openCatalog = (): void => {
    new AgentModelCatalogModal(plugin.app, descriptor, availableModels).open();
  };

  return (
    <div>
      <div className="tw-mb-2 tw-flex tw-items-center tw-justify-between">
        <div className="tw-text-sm tw-font-medium">Selected models</div>
        <Button variant="secondary" size="sm" onClick={openCatalog}>
          <Plus className="tw-mr-1 tw-size-4" />
          Add models
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="tw-rounded tw-border tw-border-dashed tw-border-border tw-px-3 tw-py-4 tw-text-center tw-text-sm tw-text-muted">
          No models selected yet. Click <span className="tw-font-medium">Add models</span> to pick
          from the {descriptor.displayName} catalog.
        </div>
      ) : (
        <div className="tw-space-y-1">
          {rows.map((row) => (
            <div
              key={row.baseModelId}
              className="tw-flex tw-items-center tw-justify-between tw-rounded tw-px-2 tw-py-1 hover:tw-bg-modifier-hover"
            >
              <div className="tw-min-w-0">
                <div className="tw-flex tw-items-center tw-gap-2 tw-truncate">
                  <span className="tw-truncate">{row.name}</span>
                  {row.unavailable && (
                    <span className="tw-text-xs tw-text-muted">(unavailable)</span>
                  )}
                </div>
                {row.description && (
                  <div className="tw-truncate tw-text-xs tw-text-muted">{row.description}</div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${row.name}`}
                onClick={() => writeAgentModelOverride(descriptor.id, row.baseModelId, false)}
              >
                <X className="tw-size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
