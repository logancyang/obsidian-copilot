/**
 * `AddProviderModal` — entry point for picking a provider to add.
 *
 * Catalog entries and built-in templates flow through the same single
 * `onPick(source)` callback as `ProviderDefinition`s. Catalog rows are
 * synthesized into `ProviderDefinition`s at pick time, carrying the
 * `catalogProviderId` link so the configure dialog can pull metadata
 * from `models.dev` for picker enrichment.
 *
 * Hosted in a native Obsidian `Modal` (popout-correct, native chrome).
 * `AddProviderContent` is the pure body, exported for unit tests.
 */
import { ReactModal } from "@/components/modals/ReactModal";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import type { CatalogProvider, ProviderType } from "@/modelManagement/types/catalog";
import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import { Plus } from "lucide-react";
import { App } from "obsidian";
import React, { useMemo, useState } from "react";

/** Top-row recommended catalog ids. Order matters. */
const RECOMMENDED_IDS: readonly string[] = ["anthropic", "openai", "google"];

/** Short descriptors shown next to each recommended provider. */
const RECOMMENDED_DESCRIPTIONS: Record<string, string> = {
  anthropic: "Claude family",
  openai: "GPT family",
  google: "Gemini family",
};

/** Default manual-add hints per provider type, used when synthesizing a
 *  `ProviderDefinition` from a catalog row (catalog has no hint). */
const PROVIDER_TYPE_HINTS: Record<ProviderType, string> = {
  anthropic: "e.g. claude-sonnet-5",
  google: "e.g. gemini-2.5-pro",
  "openai-compatible": "e.g. gpt-5",
  azure: "matches your Azure deployment name",
  bedrock: "e.g. anthropic.claude-sonnet-4-5",
};

/** Synthesize a `ProviderDefinition` from a catalog row. Carries the
 *  catalog id forward so the configure dialog can enrich rows with
 *  metadata. Catalog providers all require an API key. */
function catalogToDefinition(catalog: CatalogProvider): ProviderDefinition {
  return {
    id: catalog.id,
    displayName: catalog.displayName,
    providerType: catalog.providerType,
    defaultBaseUrl: catalog.defaultBaseUrl,
    requiresApiKey: true,
    modelInputHint: PROVIDER_TYPE_HINTS[catalog.providerType] ?? "Add a model id",
    catalogProviderId: catalog.id,
  };
}

export interface AddProviderContentProps {
  /** Catalog snapshot, owned by the panel (loaded via the catalog service). */
  catalogProviders: readonly CatalogProvider[];
  /** Local runner definitions shown in the "Self Host" group (Ollama, LM Studio). */
  localTemplates: readonly ProviderDefinition[];
  /** The bring-your-own-endpoint definition opened by the custom-provider CTA. */
  customTemplate: ProviderDefinition;
  /** Called with the chosen provider definition (catalog row or template). */
  onPick: (source: ProviderDefinition) => void;
}

/** Case-insensitive substring match on display name. */
function matchesQuery(item: { displayName: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return item.displayName.toLowerCase().includes(needle);
}

export const AddProviderContent: React.FC<AddProviderContentProps> = ({
  catalogProviders,
  localTemplates,
  customTemplate,
  onPick,
}) => {
  const [query, setQuery] = useState("");

  const { recommended, local, more } = useMemo(() => {
    const byId = new Map(catalogProviders.map((p) => [p.id, p]));
    const recommended = RECOMMENDED_IDS.map((id) => byId.get(id)).filter(
      (p): p is CatalogProvider => p !== undefined && matchesQuery(p, query)
    );
    const local = localTemplates.filter((t) => matchesQuery(t, query));
    const more = catalogProviders
      .filter((p) => !RECOMMENDED_IDS.includes(p.id) && matchesQuery(p, query))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { recommended, local, more };
  }, [catalogProviders, localTemplates, query]);

  const noMatches = recommended.length === 0 && local.length === 0 && more.length === 0;

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-gap-4 tw-overflow-hidden tw-px-2">
      <div className="tw-text-sm tw-text-muted">Pick a provider to configure.</div>

      <SearchBar value={query} onChange={setQuery} placeholder="Search providers…" />

      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-4 tw-overflow-y-auto">
        {recommended.length > 0 && (
          <section data-testid="add-provider-recommended">
            <div className="tw-mb-2 tw-text-ui-smaller tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted">
              Recommended
            </div>
            <div className="tw-flex tw-flex-col tw-gap-0.5">
              {recommended.map((p) => (
                <ProviderRow
                  key={p.id}
                  provider={p}
                  description={RECOMMENDED_DESCRIPTIONS[p.id]}
                  onClick={() => onPick(catalogToDefinition(p))}
                />
              ))}
            </div>
          </section>
        )}

        {local.length > 0 && (
          <section data-testid="add-provider-local">
            <div className="tw-mb-2 tw-text-ui-smaller tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted">
              Self Host
            </div>
            <div className="tw-flex tw-flex-col tw-gap-0.5">
              {local.map((t) => (
                <TemplateRow key={t.id} template={t} onClick={() => onPick(t)} />
              ))}
            </div>
          </section>
        )}

        {more.length > 0 && (
          <section data-testid="add-provider-more">
            <div className="tw-mb-2 tw-text-ui-smaller tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted">
              More providers
            </div>
            <div className="tw-flex tw-flex-col tw-gap-0.5">
              {more.map((p) => (
                <ProviderRow
                  key={p.id}
                  provider={p}
                  onClick={() => onPick(catalogToDefinition(p))}
                />
              ))}
            </div>
          </section>
        )}

        {noMatches && (
          <div className="tw-rounded-md tw-border tw-border-dashed tw-border-border tw-px-4 tw-py-6 tw-text-center tw-text-sm tw-text-muted">
            No providers match your search.
          </div>
        )}
      </div>

      <CustomProviderCta onClick={() => onPick(customTemplate)} />
    </div>
  );
};

interface KeyboardButtonProps {
  onClick: () => void;
  className: string;
  testId: string;
  ariaLabel: string;
  children: React.ReactNode;
}

const KeyboardButton: React.FC<KeyboardButtonProps> = ({
  onClick,
  className,
  testId,
  ariaLabel,
  children,
}) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    }}
    data-testid={testId}
    aria-label={ariaLabel}
    className={className}
  >
    {children}
  </div>
);

const ROW_CLASS = cn(
  "tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-3 tw-rounded-md",
  "tw-border tw-border-solid tw-border-transparent tw-px-3 tw-py-1.5 tw-text-left",
  "hover:tw-border-border hover:tw-bg-primary-alt/40"
);

interface TemplateRowProps {
  template: ProviderDefinition;
  onClick: () => void;
}

const TemplateRow: React.FC<TemplateRowProps> = ({ template, onClick }) => {
  const descriptor = template.defaultBaseUrl
    ? template.defaultBaseUrl.replace(/^https?:\/\//, "")
    : "custom endpoint";
  return (
    <KeyboardButton
      onClick={onClick}
      testId={`add-provider-template-${template.id}`}
      ariaLabel={`Add ${template.displayName} provider`}
      className={ROW_CLASS}
    >
      <span className="tw-flex tw-min-w-0 tw-flex-1 tw-items-baseline tw-gap-1.5 tw-truncate">
        <span className="tw-truncate tw-text-sm tw-text-normal">{template.displayName}</span>
        <span className="tw-truncate tw-text-ui-smaller tw-text-muted">— {descriptor}</span>
      </span>
      <Plus className="tw-size-4 tw-shrink-0 tw-text-muted" />
    </KeyboardButton>
  );
};

interface ProviderRowProps {
  provider: CatalogProvider;
  onClick: () => void;
  /** Optional "— family" descriptor (recommended rows only). */
  description?: string;
}

const ProviderRow: React.FC<ProviderRowProps> = ({ provider, onClick, description }) => (
  <KeyboardButton
    onClick={onClick}
    testId={`add-provider-card-${provider.id}`}
    ariaLabel={`Add ${provider.displayName} provider`}
    className={ROW_CLASS}
  >
    <span className="tw-flex tw-min-w-0 tw-flex-1 tw-items-baseline tw-gap-1.5 tw-truncate">
      <span className="tw-truncate tw-text-sm tw-text-normal">{provider.displayName}</span>
      {description && (
        <span className="tw-truncate tw-text-ui-smaller tw-text-muted">— {description}</span>
      )}
    </span>
    <Plus className="tw-size-4 tw-shrink-0 tw-text-muted" />
  </KeyboardButton>
);

const CustomProviderCta: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <KeyboardButton
    onClick={onClick}
    testId="add-provider-custom-cta"
    ariaLabel="Add a custom provider"
    className={cn(
      "tw-mt-2 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-1.5 tw-rounded-md tw-px-4 tw-py-5",
      "tw-border tw-border-solid tw-bg-interactive-accent/10 tw-border-interactive-accent/40",
      "tw-cursor-pointer tw-font-medium tw-text-accent tw-shadow-none hover:tw-bg-interactive-accent/20"
    )}
  >
    <Plus className="tw-size-4" />
    Add a custom provider
  </KeyboardButton>
);

interface AddProviderModalOptions {
  catalogProviders: readonly CatalogProvider[];
  localTemplates: readonly ProviderDefinition[];
  customTemplate: ProviderDefinition;
  onPick: (source: ProviderDefinition) => void;
}

export class AddProviderModal extends ReactModal {
  constructor(
    app: App,
    private readonly opts: AddProviderModalOptions
  ) {
    super(app, "Add a provider");
  }

  onOpen(): void {
    this.modalEl.addClasses(["tw-flex", "tw-h-[70vh]", "tw-flex-col"]);
    this.contentEl.addClasses([
      "tw-flex",
      "tw-min-h-0",
      "tw-flex-1",
      "tw-flex-col",
      "tw-overflow-hidden",
    ]);
    super.onOpen();
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <AddProviderContent
        catalogProviders={this.opts.catalogProviders}
        localTemplates={this.opts.localTemplates}
        customTemplate={this.opts.customTemplate}
        onPick={(source) => {
          this.opts.onPick(source);
          close();
        }}
      />
    );
  }
}
