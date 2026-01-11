import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { SettingKeyProviders } from "@/constants";
import { logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { StandardModel } from "@/settings/providerModels";
import {
  buildCustomModel,
  fetchModelsForProvider,
  verifyAndAddModel,
} from "@/settings/v2/utils/modelActions";
import { err2String, getProviderLabel } from "@/utils";
import { Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface ModelImporterProps {
  provider: SettingKeyProviders;
  /** Whether the provider is ready (authenticated / has API key) */
  isReady: boolean;
  /** Whether the panel is expanded - triggers auto-load when true */
  expanded?: boolean;
  /** Optional: skip verification when adding model */
  skipVerification?: boolean;
}

/**
 * Reusable component for selecting and adding models from a provider
 */
export function ModelImporter({
  provider,
  isReady,
  expanded = false,
  skipVerification = false,
}: ModelImporterProps) {
  const settings = useSettingsValue();
  const [models, setModels] = useState<StandardModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<StandardModel | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Use ref to track loading state to avoid stale closure in useCallback
  const loadingRef = useRef(false);

  const loadModels = useCallback(async () => {
    if (loadingRef.current || !isReady) return;

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const result = await fetchModelsForProvider(provider);

      if (result.success) {
        setModels(result.models);
      } else {
        setError(result.error || "Failed to load models");
        new Notice(`Failed to load models for ${getProviderLabel(provider)}: ${result.error}`, 5000);
      }
    } catch (err) {
      const errorMsg = err2String(err);
      setError(errorMsg);
      new Notice(`Failed to load models for ${getProviderLabel(provider)}: ${errorMsg}`, 5000);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [provider, isReady]);

  // Auto-load models when expanded and ready
  useEffect(() => {
    if (expanded && isReady && models === null && !loading && !error) {
      loadModels();
    }
  }, [expanded, isReady, models, loading, error, loadModels]);

  const handleAddModel = async () => {
    if (!selectedModel) {
      new Notice("Please select a model first");
      return;
    }

    setVerifying(true);

    try {
      const result = await verifyAndAddModel(
        { id: selectedModel.id, name: selectedModel.name, provider },
        settings.activeModels,
        { skipVerification }
      );

      if (result.alreadyExists) {
        if (result.verificationFailed) {
          new Notice(
            `Model ${selectedModel.name} already exists (verification failed: ${result.verificationError})`,
            10000
          );
        } else {
          new Notice(
            `Model ${selectedModel.name} verified successfully! It already exists in your models list.`
          );
        }
      } else {
        // Add the model
        const customModel = buildCustomModel({
          id: selectedModel.id,
          name: selectedModel.name,
          provider,
        });
        const updatedModels = [...settings.activeModels, customModel];
        updateSetting("activeModels", updatedModels);

        if (result.verificationFailed) {
          new Notice(
            `Model ${selectedModel.name} added (verification failed: ${result.verificationError})`,
            10000
          );
        } else {
          new Notice(`Model ${selectedModel.name} verified and added to your models list!`);
        }
      }
    } catch (err) {
      logError("Error adding model:", err);
      new Notice(`Failed to add model: ${err2String(err)}`);
    } finally {
      setVerifying(false);
    }
  };

  const sortedModels = models
    ?.filter((model, index, self) => self.findIndex((m) => m.id === model.id) === index)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <FormField
      label="Model"
      description="Add the selected model to your models list. After adding, check the Model Tab."
    >
      <div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <div className="tw-flex-1">
            <ObsidianNativeSelect
              options={
                sortedModels?.map((model) => ({
                  label: model.name,
                  value: model.id,
                })) || []
              }
              onChange={(e) => {
                const value = e.target.value;
                const model = models?.find((m) => m.id === value);
                if (model) {
                  setSelectedModel(model);
                }
              }}
              onClick={() => {
                if (models === null && !loading) {
                  loadModels();
                }
              }}
              value={selectedModel?.id || ""}
              placeholder="Select Model"
              disabled={!isReady || loading}
            />
          </div>
          <div className="tw-w-[72px]">
            <Button
              onClick={handleAddModel}
              disabled={!selectedModel || verifying}
              variant="secondary"
              size="sm"
              className="tw-w-full tw-whitespace-nowrap"
            >
              {verifying ? <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" /> : "Add"}
            </Button>
          </div>
        </div>
        <div className="tw-mt-1 tw-text-xs">
          {loading && <div className="tw-p-1 tw-text-muted">Loading models...</div>}
          {error && <div className="tw-p-1 tw-text-error">Failed to load models. {error}</div>}
          {models && models.length === 0 && (
            <div className="tw-p-1 tw-text-muted">No models available.</div>
          )}
          {models === null && !loading && !error && (
            <div className="tw-p-1 tw-text-muted">Click to load available models.</div>
          )}
        </div>
      </div>
    </FormField>
  );
}
