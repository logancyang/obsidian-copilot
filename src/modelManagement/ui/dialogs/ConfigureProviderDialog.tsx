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
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
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
 * Gate: resolve the persisted provider row AND its saved API key, and only
 * mount the stateful body once both have hydrated. Without this, the body's
 * `useState` initializers could read an empty `provider` / blank key during
 * the atom-load race and lock in values the user would then unwittingly Save.
 * Resolving the key here (rather than probing inside the body) lets edit mode
 * seed the key field with the real value — so a genuinely keyless provider is
 * visibly empty — without an empty→filled flash.
 */
export const ConfigureProviderForm: React.FC<ConfigureProviderFormProps> = ({ state, onClose }) => {
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

  // Edit mode: read the stored key once so the body can seed its field with
  // it. New mode resolves immediately with no key. A probe failure resolves
  // to `null` (treated as keyless) rather than wedging the spinner.
  //
  // Two primitive states (not one object) so a re-run that resolves the same
  // value bails out via React's `Object.is` short-circuit — the
  // `useModelManagement()` hook returns a fresh object each render, so an
  // object state here would re-render forever. Keyed on the primitive
  // `providerId` so new mode never schedules a probe.
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
      provider={provider}
      existingModels={existingModels}
      initialApiKey={initialApiKey}
    />
  );
};

interface ConfigureProviderBodyProps {
  state: ConfigureState;
  onClose: () => void;
  /** Guaranteed defined in edit mode (the gate waits for it); undefined in new mode. */
  provider: Provider | undefined;
  existingModels: readonly ConfiguredModel[];
  /** Edit mode: the stored API key, resolved by the gate. `null` for a
   *  keyless provider (or a probe failure). Always `null` in new mode. */
  initialApiKey: string | null;
}

const ConfigureProviderBody: React.FC<ConfigureProviderBodyProps> = ({
  state,
  onClose,
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

  // Warm the catalog and re-render when it (re)populates, so a cold first open
  // enriches rows the moment `models.dev` lands instead of capturing an empty
  // snapshot forever (the memo below would otherwise never recompute). Mirrors
  // the load/subscribe pattern in `ByokPanel`.
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

  // Catalog metadata for row enrichment only — never seeds the candidate
  // pool. Live catalog wins; on miss (offline, legacy id) we fall back to
  // an empty record and rows render id-only until metadata loads.
  const catalogMetadata = useMemo<Record<string, ModelInfo>>(() => {
    if (!catalogProviderId) return EMPTY_METADATA;
    return api.catalogService.getProvider(catalogProviderId)?.models ?? EMPTY_METADATA;
    // `catalogVersion` re-runs this once the catalog lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogProviderId, api, catalogVersion]);

  const [displayName, setDisplayName] = useState(() =>
    state.mode === "new" ? state.source.displayName : (provider?.displayName ?? "")
  );
  // Edit mode seeds with the resolved stored key (plaintext — it's what
  // opencode injects; the field masks it via PasswordInput's reveal toggle).
  const [apiKey, setApiKey] = useState(() => initialApiKey ?? "");
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

  // Whether this provider needs a key. New mode reads the picked definition;
  // edit mode reads the explicit persisted flag — never inferred from the
  // endpoint. Drives the Test guard, the save gate, and the inline hint.
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

  // Single verification path shared by Test and save-time auto-verify. In new
  // mode the synthetic provider carries `catalogProviderId` so the adapter's
  // per-provider verify path (e.g. OpenRouter's auth-gated `/key`) resolves —
  // without it OpenRouter's public `/models` would 200 on a blank key.
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
    // A1: a required-key provider with an empty field cannot read as
    // "Verified" — a public `/models` 200 would lie. Fail fast, no probe.
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
      // B2: auto-verify a present key before persisting so an untested-but-
      // invalid key is caught even if the user never clicked Test. Abort on a
      // conclusive failure; proceed on `ok` or an inconclusive result (offline
      // users aren't stranded). A keyless field skips the probe.
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
        apiKey: apiKey || undefined,
        requiresApiKey: state.source.requiresApiKey,
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
      // B2: re-verify only a *changed* key (unchanged keys skip the probe and
      // the keychain re-write). Abort on a conclusive failure.
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

  // Stage the clear locally (like every other field); the keychain write is
  // deferred to Save via saveProviderEdit. Empties the field so a required-key
  // provider lands in the same un-saveable "no key" state as a fresh setup.
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

  // B2: a required-key provider with an empty field can't be saved.
  const missingRequiredKey = requiresApiKey && apiKey.trim().length === 0;
  // B2: a conclusively-failed verification blocks Save. Inconclusive results
  // (network / timeout / rate_limited / http_error) do NOT block — offline
  // users can still save. A key edit resets `verification` to `null`, so an
  // untested key falls through to the save-time auto-verify in the handlers.
  const verificationBlocksSave = isConclusiveVerificationFailure(verification?.code);

  // The candidate pool only fills with models the endpoint listed (which
  // requires working credentials) or ones the user explicitly typed, so a
  // non-empty selection already implies a usable setup. On top of that, gate
  // on a present + non-conclusively-invalid key.
  const canSave = pool.selectedWireIds.size > 0 && !missingRequiredKey && !verificationBlocksSave;

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
              autoDecrypt={false}
              placeholder={state.mode === "edit" ? "No API key set" : "Paste your API key"}
            />
            <Button variant="secondary" onClick={handleTest} disabled={testing}>
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

/** Verification codes that conclusively mean "don't save" — as opposed to
 *  inconclusive results (network / timeout / rate_limited / http_error) that
 *  shouldn't strand an offline user. */
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
  /** The key the field was seeded with — used to detect a real change so an
   *  unchanged key doesn't churn the keychain (which would emit and trigger a
   *  spurious opencode restart). */
  initialApiKey: string | null;
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
  initialApiKey,
  displayName,
  effectiveBaseUrl,
  extras,
  existingModels,
  selectedWireIds,
  selectedInfos,
  api,
}: SaveEditArgs): Promise<void> {
  // Touch the keychain only when the key actually changed — re-writing an
  // unchanged key would emit and trigger a spurious opencode restart. A key
  // cleared to empty drops the keychain entry (only reachable for keyless
  // providers, since a required-key provider with an empty field can't Save).
  if (apiKey !== (initialApiKey ?? "")) {
    if (apiKey.trim().length > 0) await api.providerRegistry.setApiKey(providerId, apiKey);
    else await api.providerRegistry.clearApiKey(providerId);
  }
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
