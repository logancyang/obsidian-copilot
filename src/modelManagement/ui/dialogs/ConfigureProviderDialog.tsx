import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ReactModal } from "@/components/modals/ReactModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useApp } from "@/context";
import { logError } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { BYOK_DEFAULT_AUTO_ENROLL } from "@/modelManagement/setup/ByokSetupApi";
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { byokProvidersAtom, configuredModelsAtom } from "@/modelManagement/state/atoms";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { ProviderDefinition, VerificationResult } from "@/modelManagement/types/runtime";
import { CorsCompatibilitySetting } from "@/modelManagement/ui/components/CorsCompatibilitySetting";
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
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

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
  onSaved?: () => void;
}

export const ConfigureProviderForm: React.FC<ConfigureProviderFormProps> = ({
  state,
  onClose,
  onSaved,
}) => {
  const api = useModelManagement();
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

  const keyProviderId = state.mode === "edit" ? state.providerId : null;
  const [initialApiKey, setInitialApiKey] = useState<string | null>(null);
  const [keyResolved, setKeyResolved] = useState(keyProviderId === null);
  useEffect(() => {
    if (keyProviderId === null) return;
    let cancelled = false;
    void api.providerRegistry
      .getApiKey(keyProviderId)
      .then((key) => {
        if (cancelled) return;
        setInitialApiKey(key);
        setKeyResolved(true);
      })
      .catch(() => {
        if (!cancelled) setKeyResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [keyProviderId, api]);

  if (state.mode === "edit" && (!provider || !keyResolved)) {
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
      onSaved={onSaved}
      provider={provider}
      existingModels={existingModels}
      initialApiKey={initialApiKey}
    />
  );
};

interface ConfigureProviderBodyProps {
  state: ConfigureState;
  onClose: () => void;
  onSaved?: () => void;
  provider: Provider | undefined;
  existingModels: readonly ConfiguredModel[];
  initialApiKey: string | null;
}

const ConfigureProviderBody: React.FC<ConfigureProviderBodyProps> = ({
  state,
  onClose,
  onSaved,
  provider,
  existingModels,
  initialApiKey,
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

  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const bump = (): void => {
      if (!cancelled) setCatalogVersion((v) => v + 1);
    };
    const unsub = api.catalogService.onChange(bump);
    api.catalogService
      .ensureLoaded()
      .then(bump)
      .catch((err) => logError("[ConfigureProviderDialog] catalog ensureLoaded failed", err));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  const catalogMetadata = useMemo<Record<string, ModelInfo>>(() => {
    if (!catalogProviderId) return EMPTY_METADATA;
    return api.catalogService.getProvider(catalogProviderId)?.models ?? EMPTY_METADATA;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion intentionally invalidates metadata read through catalogService
  }, [catalogProviderId, api, catalogVersion]);

  const [displayName, setDisplayName] = useState(() =>
    state.mode === "new" ? state.source.displayName : (provider?.displayName ?? "")
  );
  const [apiKey, setApiKey] = useState(() => initialApiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(() =>
    state.mode === "edit" ? (provider?.baseUrl ?? "") : ""
  );
  const [enableCors, setEnableCors] = useState(() =>
    state.mode === "edit" ? (provider?.enableCors ?? false) : false
  );
  const [extras] = useState<Record<string, unknown>>(() =>
    state.mode === "edit" ? (provider?.extras ?? {}) : {}
  );
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  const requiresApiKey =
    state.mode === "new" ? state.source.requiresApiKey : providerRequiresApiKey(provider!);

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
    requiresApiKey,
    providerHydrated: state.mode === "edit" ? !!provider : true,
    api,
  });

  const runVerification = async (): Promise<VerificationResult> => {
    if (state.mode === "new") {
      const synthetic: Provider = {
        providerId: "test",
        providerType: providerType!,
        displayName,
        baseUrl: effectiveBaseUrl || undefined,
        requiresApiKey: state.source.requiresApiKey,
        extras,
        origin: {
          kind: "byok",
          ...(state.source.catalogProviderId
            ? { catalogProviderId: state.source.catalogProviderId }
            : {}),
        },
        addedAt: Date.now(),
      };
      return api.adapters.verifyCredentials(providerType!, {
        provider: synthetic,
        apiKey: apiKey || null,
        extras: extras ?? {},
      });
    }
    return api.adapters.verifyCredentials(providerType!, {
      provider: { ...provider!, displayName, baseUrl: effectiveBaseUrl || undefined, extras },
      apiKey: apiKey || null,
      extras: extras ?? {},
    });
  };

  const handleTest = async (): Promise<void> => {
    if (!providerType) return;
    if (requiresApiKey && apiKey.trim().length === 0) {
      setVerification({
        ok: false,
        code: "missing_api_key",
        message: "Enter an API key to verify this provider.",
        checkedAt: Date.now(),
      });
      return;
    }
    setTesting(true);
    try {
      const result = await runVerification();
      setVerification(result);
      if (result.ok) {
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
      if (apiKey.trim().length > 0) {
        const result = await runVerification();
        if (!result.ok && isConclusiveVerificationFailure(result.code)) {
          setVerification(result);
          return;
        }
      }
      await api.setup.byok.setupProvider({
        catalogProviderId: state.source.catalogProviderId,
        providerType,
        displayName,
        baseUrl: effectiveBaseUrl || undefined,
        enableCors,
        apiKey: apiKey || undefined,
        requiresApiKey: state.source.requiresApiKey,
        extras: Object.keys(extras).length > 0 ? extras : undefined,
        models: pool.buildSelectedModelInfos(),
      });
      onSaved?.();
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
      const keyChanged = apiKey !== (initialApiKey ?? "");
      if (keyChanged && apiKey.trim().length > 0) {
        const result = await runVerification();
        if (!result.ok && isConclusiveVerificationFailure(result.code)) {
          setVerification(result);
          return;
        }
      }
      await saveProviderEdit({
        providerId: state.providerId,
        apiKey,
        initialApiKey,
        displayName,
        effectiveBaseUrl,
        enableCors,
        extras,
        existingModels,
        selectedWireIds: pool.selectedWireIds,
        selectedInfos: pool.buildSelectedModelInfos(),
        api,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      logError("[ConfigureProviderDialog] save changes failed", err);
      new Notice("Failed to save changes. See console for details.");
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = (): void => {
    setApiKey("");
    setVerification(null);
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

  const missingRequiredKey = requiresApiKey && apiKey.trim().length === 0;
  const verificationBlocksSave = isConclusiveVerificationFailure(verification?.code);

  // A non-catalog OpenAI-compatible provider has no native routing default, so
  // persisting it without a Base URL creates a model that no backend can call.
  // https://github.com/logancyang/obsidian-copilot/issues/2895
  const missingCustomBaseUrl =
    providerType === "openai-compatible" && !catalogProviderId && !effectiveBaseUrl;

  const canSave =
    pool.selectedWireIds.size > 0 &&
    !missingCustomBaseUrl &&
    !missingRequiredKey &&
    !verificationBlocksSave;

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
              <span className="tw-text-ui-smaller tw-font-normal tw-text-muted">
                {requiresApiKey ? "required" : "optional"}
              </span>
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
              placeholder={state.mode === "edit" ? "No API key set" : "Paste your API key"}
            />
            <Button variant="secondary" onClick={safeAsyncHandler(handleTest)} disabled={testing}>
              {testing ? <Loader2 className="tw-size-4 tw-animate-spin" /> : "Test"}
            </Button>
            {state.mode === "edit" && apiKey.length > 0 && (
              <Button variant="destructive" onClick={handleClearKey} data-testid="api-key-clear">
                Clear
              </Button>
            )}
          </div>
          {testFailed ? (
            <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-error">
              <XCircle className="tw-size-3.5 tw-shrink-0" />
              <span>{verification?.message || "Verification failed"}</span>
            </div>
          ) : (
            missingRequiredKey && (
              <div className="tw-text-xs tw-text-muted">
                An API key is required for this provider.
              </div>
            )
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

        <CorsCompatibilitySetting checked={enableCors} onCheckedChange={setEnableCors} />

        <div className="tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-sm tw-font-medium tw-text-normal">Models</div>
          <ModelChecklist
            availableModels={pool.availableModels}
            selected={pool.selectedWireIds}
            onToggle={pool.toggle}
            onAddId={pool.addId}
            onRemoveId={pool.removeId}
            customIds={pool.customIds}
            query={modelQuery}
            onQueryChange={setModelQuery}
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
          <Button
            variant="default"
            onClick={safeAsyncHandler(handleSaveNew)}
            disabled={!canSave || saving}
          >
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
            <Button
              variant="default"
              onClick={safeAsyncHandler(handleSaveEdit)}
              disabled={!canSave || saving}
            >
              {saving ? <Loader2 className="tw-size-4 tw-animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const CONCLUSIVE_VERIFICATION_FAILURE_CODES: readonly string[] = [
  "invalid_api_key",
  "missing_api_key",
  "missing_base_url",
];

function isConclusiveVerificationFailure(code: string | undefined): boolean {
  return code !== undefined && CONCLUSIVE_VERIFICATION_FAILURE_CODES.includes(code);
}

interface SaveEditArgs {
  providerId: string;
  apiKey: string;
  initialApiKey: string | null;
  displayName: string;
  effectiveBaseUrl: string;
  enableCors: boolean;
  extras: Record<string, unknown>;
  existingModels: readonly ConfiguredModel[];
  selectedWireIds: ReadonlySet<string>;
  selectedInfos: ModelInfo[];
  api: ModelManagementApi;
}

async function saveProviderEdit({
  providerId,
  apiKey,
  initialApiKey,
  displayName,
  effectiveBaseUrl,
  enableCors,
  extras,
  existingModels,
  selectedWireIds,
  selectedInfos,
  api,
}: SaveEditArgs): Promise<void> {
  if (apiKey !== (initialApiKey ?? "")) {
    if (apiKey.trim().length > 0) await api.providerRegistry.setApiKey(providerId, apiKey);
    else await api.providerRegistry.clearApiKey(providerId);
  }
  await api.providerRegistry.update(providerId, {
    displayName,
    baseUrl: effectiveBaseUrl || undefined,
    enableCors,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  });

  const deselectedIds = existingModels
    .filter((m) => !selectedWireIds.has(m.info.id))
    .map((m) => m.configuredModelId);
  const prevWireIds = new Set(existingModels.map((m) => m.info.id));
  const ids = await api.configuredModelRegistry.bulkSet(providerId, selectedInfos);
  if (deselectedIds.length > 0) {
    await api.backendConfigRegistry.removeRefs(deselectedIds);
  }

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
  onSaved?: () => void;
}

export class ConfigureProviderModal extends ReactModal {
  constructor(
    app: App,
    private readonly opts: ConfigureProviderModalOptions
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClasses(["tw-flex", "tw-max-h-[85vh]", "tw-flex-col"]);
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
        <ConfigureProviderForm
          state={this.opts.state}
          onClose={close}
          onSaved={this.opts.onSaved}
        />
      </ModelManagementProvider>
    );
  }
}
