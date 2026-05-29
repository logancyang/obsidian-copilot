/**
 * `ConfigureProviderModal` — credentials + model selection for a BYOK
 * provider. Two modes:
 *   - `new`:  the user just picked a provider definition in
 *             AddProviderModal (catalog-backed or built-in template;
 *             same shape either way). Nothing is persisted until Save.
 *   - `edit`: re-open an existing provider to change its name / key /
 *             base URL / model selection, or remove it.
 *
 * The model picker is uniform across both modes — `models.dev` is a
 * metadata enhancer, not a source of truth. The candidate-pool machine
 * lives in `useModelCandidatePool`; this file is the dialog shell:
 *   - `ConfigureProviderForm` resolves the persisted provider row from
 *     Jotai atoms and gates rendering until it hydrates (edit mode).
 *   - `ConfigureProviderBody` is the stateful body — credential fields,
 *     status flags, and the picker — routing mutations through
 *     `useModelManagement()`. It mounts only once `provider` is settled,
 *     so its `useState` initializers seed from real persisted values.
 *
 * Hosted in a native Obsidian `Modal`. `ConfigureProviderForm` is exported
 * for unit tests.
 */
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ReactModal } from "@/components/modals/ReactModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { SearchBar } from "@/components/ui/SearchBar";
import { useApp } from "@/context";
import { logError } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { BYOK_DEFAULT_AUTO_ENROLL } from "@/modelManagement/setup/ByokSetupApi";
import { byokProvidersAtom, configuredModelsAtom } from "@/modelManagement/state/atoms";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { ProviderDefinition, VerificationResult } from "@/modelManagement/types/runtime";
import { ModelChecklist } from "@/modelManagement/ui/components/ModelChecklist";
import {
  ModelManagementProvider,
  useModelManagement,
} from "@/modelManagement/ui/ModelManagementContext";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { App, Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";
import { useModelCandidatePool } from "./useModelCandidatePool";

/**
 * Default API endpoints for SDK-native catalog providers that `models.dev`
 * omits an `api` field for. Used as the Base URL placeholder and effective
 * value when the form field is blank. Keyed by catalog provider id.
 */
const KNOWN_DEFAULT_ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com",
};

const EMPTY_METADATA: Record<string, ModelInfo> = Object.freeze({});
const EMPTY_MODELS: readonly ConfiguredModel[] = Object.freeze([]);

export type ConfigureState =
  | { mode: "new"; source: ProviderDefinition }
  | { mode: "edit"; providerId: string };

interface ConfigureProviderFormProps {
  state: ConfigureState;
  onClose: () => void;
}

/**
 * Gate: resolve the persisted provider row and only mount the stateful body
 * once it has hydrated. Without this, the body's `useState` initializers
 * could read an empty `provider` during the atom-load race and lock in blank
 * values the user would then unwittingly Save.
 */
export const ConfigureProviderForm: React.FC<ConfigureProviderFormProps> = ({ state, onClose }) => {
  const byokProviders = useAtomValue(byokProvidersAtom, { store: settingsStore });
  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });

  const provider = useMemo<Provider | undefined>(
    () =>
      state.mode === "edit"
        ? byokProviders.find((p) => p.providerId === state.providerId)
        : undefined,
    [state, byokProviders]
  );

  const existingModels = useMemo(
    () =>
      state.mode === "edit"
        ? configuredModels.filter((m) => m.providerId === state.providerId)
        : EMPTY_MODELS,
    [state, configuredModels]
  );

  if (state.mode === "edit" && !provider) {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center">
        <Loader2 className="tw-size-5 tw-animate-spin tw-text-muted" />
      </div>
    );
  }

  return (
    <ConfigureProviderBody
      state={state}
      onClose={onClose}
      provider={provider}
      existingModels={existingModels}
    />
  );
};

interface ConfigureProviderBodyProps {
  state: ConfigureState;
  onClose: () => void;
  /** Guaranteed defined in edit mode (the gate waits for it); undefined in new mode. */
  provider: Provider | undefined;
  existingModels: readonly ConfiguredModel[];
}

const ConfigureProviderBody: React.FC<ConfigureProviderBodyProps> = ({
  state,
  onClose,
  provider,
  existingModels,
}) => {
  const api = useModelManagement();
  const app = useApp();

  const providerType: ProviderType | undefined =
    state.mode === "new" ? state.source.providerType : provider?.providerType;

  const catalogProviderId: string | undefined =
    state.mode === "new"
      ? state.source.catalogProviderId
      : provider?.origin.kind === "byok"
        ? provider.origin.catalogProviderId
        : undefined;

  // Catalog metadata for row enrichment only — never seeds the candidate
  // pool. Live catalog wins; on miss (offline, legacy id) we fall back to
  // an empty record and rows render id-only until metadata loads.
  const catalogMetadata = useMemo<Record<string, ModelInfo>>(() => {
    if (!catalogProviderId) return EMPTY_METADATA;
    return api.catalogService.getProvider(catalogProviderId)?.models ?? EMPTY_METADATA;
  }, [catalogProviderId, api]);

  const [displayName, setDisplayName] = useState(() =>
    state.mode === "new" ? state.source.displayName : (provider?.displayName ?? "")
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(() =>
    state.mode === "edit" ? (provider?.baseUrl ?? "") : ""
  );
  const [extras] = useState<Record<string, unknown>>(() =>
    state.mode === "edit" ? (provider?.extras ?? {}) : {}
  );
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  const hasSavedKey = useSavedKeyProbe(
    state.mode,
    state.mode === "edit" ? state.providerId : undefined,
    api
  );

  const defaultBaseUrl =
    state.mode === "new"
      ? (state.source.defaultBaseUrl ??
        KNOWN_DEFAULT_ENDPOINTS[state.source.catalogProviderId ?? ""] ??
        "")
      : (provider?.baseUrl ?? KNOWN_DEFAULT_ENDPOINTS[catalogProviderId ?? ""] ?? "");
  const effectiveBaseUrl = baseUrl.trim() || defaultBaseUrl;

  const pool = useModelCandidatePool({
    mode: state.mode,
    providerId: state.mode === "edit" ? state.providerId : undefined,
    providerType,
    effectiveBaseUrl,
    existingModels,
    catalogMetadata,
    apiKey,
    extras,
    requiresApiKey: state.mode === "new" ? state.source.requiresApiKey : false,
    providerHydrated: state.mode === "edit" ? !!provider : true,
    api,
  });

  const handleTest = async (): Promise<void> => {
    if (!providerType) return;
    setTesting(true);
    try {
      let result: VerificationResult;
      if (state.mode === "new") {
        const synthetic: Provider = {
          providerId: "test",
          providerType,
          displayName,
          baseUrl: effectiveBaseUrl || undefined,
          extras,
          origin: { kind: "byok" },
          addedAt: Date.now(),
        };
        result = await api.adapters.verifyCredentials(providerType, {
          provider: synthetic,
          apiKey: apiKey || null,
          extras: extras ?? {},
        });
      } else if (provider) {
        const key = apiKey || (await api.providerRegistry.getApiKey(state.providerId));
        result = await api.adapters.verifyCredentials(providerType, {
          provider: { ...provider, displayName, baseUrl: effectiveBaseUrl || undefined, extras },
          apiKey: key || null,
          extras: extras ?? {},
        });
      } else {
        return;
      }
      setVerification(result);
      if (result.ok) {
        // Successful auth — refetch the model list, since the previous
        // mount-time fetch may have skipped or 401'd.
        await pool.fetchModels();
      }
    } catch (err) {
      setVerification({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now(),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveNew = async (): Promise<void> => {
    if (state.mode !== "new" || !providerType) return;
    setSaving(true);
    try {
      await api.setup.byok.setupProvider({
        catalogProviderId: state.source.catalogProviderId,
        providerType,
        displayName,
        baseUrl: effectiveBaseUrl || undefined,
        apiKey: apiKey || undefined,
        extras,
        models: pool.buildSelectedModelInfos(),
      });
      onClose();
    } catch (err) {
      logError("[ConfigureProviderDialog] setupProvider failed", err);
      new Notice("Failed to save provider. See console for details.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (state.mode !== "edit" || !provider) return;
    setSaving(true);
    try {
      await saveProviderEdit({
        providerId: state.providerId,
        apiKey,
        displayName,
        effectiveBaseUrl,
        extras,
        existingModels,
        selectedWireIds: pool.selectedWireIds,
        selectedInfos: pool.buildSelectedModelInfos(),
        api,
      });
      onClose();
    } catch (err) {
      logError("[ConfigureProviderDialog] save changes failed", err);
      new Notice("Failed to save changes. See console for details.");
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async (): Promise<void> => {
    if (state.mode !== "edit") return;
    try {
      await api.providerRegistry.clearApiKey(state.providerId);
      onClose();
    } catch (err) {
      logError("[ConfigureProviderDialog] clearApiKey failed", err);
      new Notice("Failed to clear API key. See console for details.");
    }
  };

  const handleRemove = (): void => {
    if (state.mode !== "edit" || !provider) return;
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeProvider(state.providerId);
          onClose();
        } catch (err) {
          logError("[ConfigureProviderDialog] removeProvider failed", err);
          new Notice("Failed to remove provider.");
        }
      },
      `Remove ${provider.displayName}? This also removes all of its models from every model picker.`,
      "Remove provider",
      "Remove",
      "Cancel"
    );
    modal.open();
  };

  const headerName =
    state.mode === "new" ? state.source.displayName : (provider?.displayName ?? displayName);

  // The candidate pool only fills with models the endpoint listed (which
  // requires working credentials) or ones the user explicitly typed, so a
  // non-empty selection already implies a usable setup. No need to
  // re-gate on base URL or test status.
  const canSave = pool.selectedWireIds.size > 0;

  const testFailed = verification?.ok === false;

  const modelInputHint = state.mode === "new" ? state.source.modelInputHint : undefined;

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-gap-4 tw-overflow-hidden">
      <div className="tw-flex tw-flex-col tw-gap-1 tw-border-b tw-border-border tw-px-2 tw-pb-3">
        <div className="tw-text-lg tw-font-semibold tw-leading-none tw-tracking-tight">
          Configure {headerName}
        </div>
        <div className="tw-text-sm tw-text-muted">
          Enter credentials and choose which models to enable.
        </div>
      </div>

      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-4 tw-overflow-y-auto tw-px-2 tw-py-1">
        <FormField label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </FormField>

        <FormField
          label={
            <span className="tw-inline-flex tw-items-center tw-gap-2">
              API key
              <span className="tw-text-ui-smaller tw-font-normal tw-text-muted">optional</span>
              {verification?.ok === true && (
                <Badge className="tw-gap-1 tw-bg-success tw-text-success">
                  <CheckCircle2 className="tw-size-3" />
                  Verified
                </Badge>
              )}
            </span>
          }
        >
          <div className="tw-flex tw-gap-2">
            <PasswordInput
              className="tw-flex-1"
              value={apiKey}
              onChange={(v) => {
                setApiKey(v);
                setVerification(null);
              }}
              autoDecrypt={false}
              placeholder={
                state.mode === "edit"
                  ? "Enter a new key to replace the saved one"
                  : "Paste your API key"
              }
            />
            <Button variant="secondary" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="tw-size-4 tw-animate-spin" /> : "Test"}
            </Button>
            {state.mode === "edit" && hasSavedKey && (
              <Button variant="destructive" onClick={handleClearKey} data-testid="api-key-clear">
                Clear
              </Button>
            )}
          </div>
          {testFailed && (
            <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-error">
              <XCircle className="tw-size-3.5 tw-shrink-0" />
              <span>{verification?.message || "Verification failed"}</span>
            </div>
          )}
        </FormField>

        <FormField label="Base URL">
          <Input
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setVerification(null);
            }}
            placeholder={defaultBaseUrl}
          />
        </FormField>

        <div className="tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-sm tw-font-medium tw-text-normal">Models</div>
          <SearchBar value={modelQuery} onChange={setModelQuery} placeholder="Search models..." />
          <ModelChecklist
            availableModels={pool.availableModels}
            selected={pool.selectedWireIds}
            onToggle={pool.toggle}
            onAddId={pool.addId}
            onRemoveId={pool.removeId}
            customIds={pool.customIds}
            query={modelQuery}
            modelInputHint={modelInputHint}
            fetching={pool.fetching}
            fetchError={pool.fetchError}
          />
        </div>
      </div>

      {state.mode === "new" ? (
        <div className="tw-flex tw-flex-col-reverse tw-gap-2 tw-px-2 sm:tw-flex-row sm:tw-justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleSaveNew} disabled={!canSave || saving}>
            {saving ? <Loader2 className="tw-size-4 tw-animate-spin" /> : "Save"}
          </Button>
        </div>
      ) : (
        <div className="tw-flex tw-flex-col-reverse tw-gap-2 tw-px-2 sm:tw-flex-row sm:tw-justify-between">
          <Button variant="destructive" onClick={handleRemove} disabled={saving}>
            Remove provider
          </Button>
          <div className="tw-flex tw-gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleSaveEdit} disabled={!canSave || saving}>
              {saving ? <Loader2 className="tw-size-4 tw-animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Probe the keychain once in edit mode so the "Clear" button can show only
 * when there's something to clear. Probe failures are non-fatal — the button
 * just won't appear.
 */
function useSavedKeyProbe(
  mode: ConfigureState["mode"],
  providerId: string | undefined,
  api: ModelManagementApi
): boolean {
  const [hasSavedKey, setHasSavedKey] = useState(false);
  useEffect(() => {
    if (mode !== "edit" || !providerId) return;
    let cancelled = false;
    void api.providerRegistry
      .getApiKey(providerId)
      .then((key) => {
        if (!cancelled) setHasSavedKey(!!key);
      })
      .catch(() => {
        // non-fatal
      });
    return () => {
      cancelled = true;
    };
  }, [mode, providerId, api]);
  return hasSavedKey;
}

interface SaveEditArgs {
  providerId: string;
  apiKey: string;
  displayName: string;
  effectiveBaseUrl: string;
  extras: Record<string, unknown>;
  existingModels: readonly ConfiguredModel[];
  selectedWireIds: ReadonlySet<string>;
  selectedInfos: ModelInfo[];
  api: ModelManagementApi;
}

/**
 * Persist edit-mode changes. Ordering matters: compute the deselect set
 * BEFORE bulkSet (which replaces the rows) so we still have the old
 * configuredModelIds in hand. Run bulkSet FIRST: if it throws, settings stay
 * consistent — `existingModels` unchanged, backends still reference live
 * rows. Removing backend refs before bulkSet would leak a window where
 * backends point at configured-model rows the user just deselected but
 * bulkSet hasn't dropped yet (and would emit a spurious opencode restart if
 * bulkSet then throws).
 */
async function saveProviderEdit({
  providerId,
  apiKey,
  displayName,
  effectiveBaseUrl,
  extras,
  existingModels,
  selectedWireIds,
  selectedInfos,
  api,
}: SaveEditArgs): Promise<void> {
  if (apiKey) await api.providerRegistry.setApiKey(providerId, apiKey);
  await api.providerRegistry.update(providerId, {
    displayName,
    baseUrl: effectiveBaseUrl || undefined,
    extras,
  });

  const deselectedIds = existingModels
    .filter((m) => !selectedWireIds.has(m.info.id))
    .map((m) => m.configuredModelId);
  const prevWireIds = new Set(existingModels.map((m) => m.info.id));
  const ids = await api.configuredModelRegistry.bulkSet(providerId, selectedInfos);
  if (deselectedIds.length > 0) {
    await api.backendConfigRegistry.removeRefs(deselectedIds);
  }

  // Auto-enroll only the truly new (and non-embedding) ids so we preserve
  // the user's curated enrollments on previously-saved models.
  for (let i = 0; i < selectedInfos.length; i++) {
    if (prevWireIds.has(selectedInfos[i].id)) continue;
    if (selectedInfos[i].isEmbedding) continue;
    for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
      await api.backendConfigRegistry.enableModel(backend, ids[i]);
    }
  }
}

interface ConfigureProviderModalOptions {
  state: ConfigureState;
  api: ModelManagementApi;
}

export class ConfigureProviderModal extends ReactModal {
  constructor(
    app: App,
    private readonly opts: ConfigureProviderModalOptions
  ) {
    super(app);
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
      <ModelManagementProvider api={this.opts.api}>
        <ConfigureProviderForm state={this.opts.state} onClose={close} />
      </ModelManagementProvider>
    );
  }
}
