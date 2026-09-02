/**
 * BYOK settings panel — the central registry UI.
 *
 * Lists every BYOK provider (origin `"byok"`) with its configured models,
 * and drives the add / configure / remove flows. Reactive reads come from
 * Jotai atoms; mutations go through `useModelManagement()`. The catalog is
 * loaded once on mount (disk cache, no network unless stale) and kept in
 * local state so it can be passed down to the Add Provider dialog.
 */
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/SearchBar";
import { useApp } from "@/context";
import { logError } from "@/logger";
import {
  CUSTOM_OPENAI_DEFINITION,
  LOCAL_PROVIDER_DEFINITIONS,
} from "@/modelManagement/catalog/builtinDefinitions";
import { configuredModelsAtom, visibleByokProvidersAtom } from "@/modelManagement/state/atoms";
import { providerNeedsSelfHostWarning } from "@/modelManagement/providers/selfHostPolicy";
import type { CatalogProvider } from "@/modelManagement/types/catalog";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";
import { useModelManagement } from "@/modelManagement/ui/ModelManagementContext";
import {
  ByokGlobalTable,
  type ByokTableGroup,
} from "@/modelManagement/ui/components/ByokGlobalTable";
import { AddProviderModal } from "@/modelManagement/ui/dialogs/AddProviderDialog";
import { ConfigureProviderModal } from "@/modelManagement/ui/dialogs/ConfigureProviderDialog";
import { settingsStore, useSettingsValue } from "@/settings/model";
import { useAtomValue } from "jotai";
import { Plus, ShieldCheck } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";

const EMPTY_CATALOG: readonly CatalogProvider[] = Object.freeze([]);
const EMPTY_MODELS: readonly ConfiguredModel[] = Object.freeze([]);

/**
 * `ByokPanel` — root component for the Models settings tab.
 */
export const ByokPanel: React.FC = () => {
  const api = useModelManagement();
  const app = useApp();

  // Self-Host Mode keeps cloud BYOK providers listed but sorts them below
  // self-hosted / local endpoints (each is flagged in-row). Projection only —
  // nothing is removed from disk or reordered in settings.
  const providers = useAtomValue(visibleByokProvidersAtom, { store: settingsStore });
  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const selfHostOn = useSettingsValue().enableSelfHostMode;

  const [catalogProviders, setCatalogProviders] =
    useState<readonly CatalogProvider[]>(EMPTY_CATALOG);
  const [loadState, setLoadState] = useState<"loading" | "ready">("loading");
  const [query, setQuery] = useState("");

  // Load the catalog once and keep our snapshot in sync. The disk-load path
  // of `ensureLoaded` does NOT fire `onChange`, so we sync explicitly after
  // it resolves; `onChange` covers manual refreshes.
  useEffect(() => {
    let cancelled = false;
    const sync = (): void => {
      if (!cancelled) setCatalogProviders(api.catalogService.getAllProviders());
    };
    const unsub = api.catalogService.onChange(sync);
    api.catalogService
      .ensureLoaded()
      .then(() => {
        if (cancelled) return;
        sync();
        setLoadState("ready");
      })
      .catch((err) => {
        logError("[ByokPanel] catalog ensureLoaded failed", err);
        if (!cancelled) setLoadState("ready");
      });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  const groups = useMemo<ByokTableGroup[]>(() => {
    const byProvider = new Map<string, ConfiguredModel[]>();
    for (const model of configuredModels) {
      const list = byProvider.get(model.providerId);
      if (list) list.push(model);
      else byProvider.set(model.providerId, [model]);
    }
    const q = query.trim().toLowerCase();
    return providers
      .map((provider) => {
        const needsSelfHostWarning =
          selfHostOn && providerNeedsSelfHostWarning(provider, { enableSelfHostMode: selfHostOn });
        const all = byProvider.get(provider.providerId) ?? (EMPTY_MODELS as ConfiguredModel[]);
        if (!q || provider.displayName.toLowerCase().includes(q)) {
          return { provider, models: all, needsSelfHostWarning };
        }
        const models = all.filter(
          (m) => m.info.displayName.toLowerCase().includes(q) || m.info.id.toLowerCase().includes(q)
        );
        return { provider, models, needsSelfHostWarning };
      })
      .filter((g) => !q || g.models.length > 0 || g.provider.displayName.toLowerCase().includes(q));
  }, [providers, configuredModels, query, selfHostOn]);

  const handleAddProvider = (): void => {
    new AddProviderModal(app, {
      catalogProviders,
      localTemplates: LOCAL_PROVIDER_DEFINITIONS,
      customTemplate: CUSTOM_OPENAI_DEFINITION,
      onPick: (source) =>
        new ConfigureProviderModal(app, { state: { mode: "new", source }, api }).open(),
    }).open();
  };

  const handleRemove = (providerId: string): void => {
    const provider = providers.find((p) => p.providerId === providerId);
    if (!provider) return;
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeProvider(providerId);
        } catch (err) {
          logError("[ByokPanel] removeProvider failed", err);
          new Notice(t("settings.byok.notice.removeProviderFailed"));
        }
      },
      t("settings.byok.removeProvider.confirm", { provider: provider.displayName }),
      t("settings.byok.removeProvider.title"),
      t("settings.actions.remove"),
      t("settings.actions.cancel")
    );
    modal.open();
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-py-4">
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-4">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-xl tw-font-bold tw-text-normal">BYOK</div>
          <div className="tw-max-w-xl tw-text-sm tw-text-muted">
            {t("settings.byok.description")}
          </div>
        </div>
        <Button className="tw-shrink-0" onClick={handleAddProvider}>
          <Plus className="tw-size-4" />
          {t("settings.byok.addProvider")}
        </Button>
      </div>

      {selfHostOn && (
        <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-px-3 tw-py-2.5 tw-text-xs tw-text-normal tw-bg-interactive-accent/10 tw-border-interactive-accent/30">
          <ShieldCheck className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
          <div className="tw-leading-relaxed">{t("settings.byok.selfHostNotice")}</div>
        </div>
      )}

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder={t("settings.byok.searchProviders")}
      />

      <div className="tw-flex tw-flex-col">
        {loadState === "loading" ? (
          <div className="tw-text-sm tw-text-muted">{t("settings.byok.loadingCatalog")}</div>
        ) : (
          <ByokGlobalTable
            groups={groups}
            emptyMessage={
              query.trim() && providers.length > 0
                ? t("settings.byok.noProviderMatches")
                : undefined
            }
            onConfigure={(id) =>
              new ConfigureProviderModal(app, {
                state: { mode: "edit", providerId: id },
                api,
              }).open()
            }
            onRemove={handleRemove}
          />
        )}
      </div>
    </div>
  );
};
