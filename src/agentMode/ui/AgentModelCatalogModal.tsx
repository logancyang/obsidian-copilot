import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { ProviderInfo } from "@/constants";
import { getBackendModelOverrides } from "@/agentMode/session/backendSettingsAccess";
import { isAgentModelEnabled, writeAgentModelOverride } from "@/agentMode/session/modelEnable";
import type { BackendDescriptor, ModelEntry } from "@/agentMode/session/types";
import { useSettingsValue } from "@/settings/model";
import { ChevronDown, ChevronRight } from "lucide-react";
import { App } from "obsidian";
import React from "react";

interface AgentModelCatalogContentProps {
  descriptor: BackendDescriptor;
  availableModels: ReadonlyArray<ModelEntry>;
  onClose: () => void;
}

interface ProviderGroup {
  /** Stable key — Copilot provider enum value, or "__other__" for null. */
  key: string;
  /** Human-readable group label (e.g. "OpenRouter"). */
  label: string;
  entries: ModelEntry[];
}

const OTHER_GROUP_KEY = "__other__";

/**
 * Groups at or below this size auto-expand on first open. Large catalogs
 * (e.g. OpenRouter's models.dev snapshot) stay collapsed so they don't
 * drown out smaller curated providers — the user expands them on demand.
 */
const AUTO_EXPAND_GROUP_SIZE = 25;

/** Resolve a Copilot provider id to its human-readable label. */
function providerLabel(provider: string | null): string {
  if (!provider) return "Other";
  // ProviderInfo is keyed by ChatModelProviders enum *value* (e.g. "openrouterai").
  const meta = (ProviderInfo as Record<string, { label: string } | undefined>)[provider];
  return meta?.label ?? provider;
}

/** Group catalog entries by provider, preserving first-seen order. */
function groupByProvider(entries: ReadonlyArray<ModelEntry>): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const entry of entries) {
    const key = entry.provider ?? OTHER_GROUP_KEY;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, {
        key,
        label: providerLabel(entry.provider),
        entries: [entry],
      });
    }
  }
  // Sort: real providers alphabetically, "Other" last.
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === OTHER_GROUP_KEY) return 1;
    if (b.key === OTHER_GROUP_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Filter a group's entries by a search query (case-insensitive across
 * `name` and `baseModelId`). Returns the original array reference when
 * the query is empty so the caller can fast-path "no filtering."
 */
function filterEntries(entries: ReadonlyArray<ModelEntry>, query: string): ModelEntry[] {
  if (!query) return entries as ModelEntry[];
  const q = query.toLowerCase();
  return entries.filter(
    (e) => e.name.toLowerCase().includes(q) || e.baseModelId.toLowerCase().includes(q)
  );
}

const AgentModelCatalogContent: React.FC<AgentModelCatalogContentProps> = ({
  descriptor,
  availableModels,
  onClose,
}) => {
  // Subscribe to settings so toggle flips re-render rows live.
  const settings = useSettingsValue();
  const overrides = getBackendModelOverrides(settings, descriptor.id);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const groups = React.useMemo(() => groupByProvider(availableModels), [availableModels]);
  const filteredGroups = React.useMemo(
    () =>
      groups
        .map((g) => ({ ...g, entries: filterEntries(g.entries, query) }))
        .filter((g) => g.entries.length > 0),
    [groups, query]
  );

  const isExpanded = (group: ProviderGroup): boolean => {
    // While searching, auto-expand any group with matches so results are
    // visible without an extra click.
    if (query) return true;
    // Explicit user toggle wins.
    const userToggle = expanded[group.key];
    if (typeof userToggle === "boolean") return userToggle;
    // Default: small catalogs (claude, codex, anthropic in opencode) open
    // immediately; oversized ones (OpenRouter) stay collapsed until asked.
    return group.entries.length <= AUTO_EXPAND_GROUP_SIZE;
  };

  const toggleExpanded = (group: ProviderGroup): void => {
    const currentlyOpen = isExpanded(group);
    setExpanded((prev) => ({ ...prev, [group.key]: !currentlyOpen }));
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-3" style={{ minHeight: 480 }}>
      <Input
        type="text"
        placeholder="Search models by name or id…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div className="tw-flex-1 tw-overflow-y-auto tw-pr-1" style={{ maxHeight: "60vh" }}>
        {filteredGroups.length === 0 ? (
          <div className="tw-py-8 tw-text-center tw-text-sm tw-text-muted">
            No models match &ldquo;{query}&rdquo;.
          </div>
        ) : (
          <div className="tw-space-y-2">
            {filteredGroups.map((group) => (
              <Collapsible
                key={group.key}
                open={isExpanded(group)}
                onOpenChange={() => toggleExpanded(group)}
              >
                <CollapsibleTrigger
                  className="tw-flex tw-w-full tw-items-center tw-justify-between tw-rounded tw-px-2 tw-py-1.5 tw-text-left hover:tw-bg-modifier-hover"
                  type="button"
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    {isExpanded(group) ? (
                      <ChevronDown className="tw-size-4 tw-text-muted" />
                    ) : (
                      <ChevronRight className="tw-size-4 tw-text-muted" />
                    )}
                    <span className="tw-font-medium">{group.label}</span>
                  </div>
                  <span className="tw-text-xs tw-text-muted">{group.entries.length}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="tw-mt-1 tw-space-y-1 tw-pl-6">
                    {group.entries.map((entry) => {
                      const enabled = isAgentModelEnabled(
                        descriptor,
                        { modelId: entry.baseModelId, name: entry.name },
                        overrides
                      );
                      return (
                        <div
                          key={entry.baseModelId}
                          className="tw-flex tw-items-center tw-justify-between tw-rounded tw-px-2 tw-py-1 hover:tw-bg-modifier-hover"
                        >
                          <div className="tw-min-w-0">
                            <div className="tw-truncate">{entry.name || entry.baseModelId}</div>
                            {entry.description && (
                              <div className="tw-truncate tw-text-xs tw-text-muted">
                                {entry.description}
                              </div>
                            )}
                          </div>
                          <SettingSwitch
                            checked={enabled}
                            onCheckedChange={(next) =>
                              writeAgentModelOverride(descriptor.id, entry.baseModelId, next)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </div>

      <div className="tw-flex tw-justify-end">
        <Button variant="default" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
};

/**
 * Obsidian-native modal listing every model in a backend's
 * `availableModels` catalog, grouped by provider with a sticky search
 * input. Toggles persist immediately via `writeAgentModelOverride`; no
 * separate save step.
 */
export class AgentModelCatalogModal extends ReactModal {
  constructor(
    app: App,
    private readonly descriptor: BackendDescriptor,
    private readonly availableModels: ReadonlyArray<ModelEntry>
  ) {
    super(app, `Available ${descriptor.displayName} models`);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <AgentModelCatalogContent
        descriptor={this.descriptor}
        availableModels={this.availableModels}
        onClose={close}
      />
    );
  }
}
