import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { ChatModelProviders } from "@/constants";
import ProjectManager from "@/LLMProviders/projectManager";
import { logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { err2String } from "@/utils";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Notice, requestUrl } from "obsidian";
import React, { useState } from "react";

/** Supported local service provider types */
type LocalServiceKind = ChatModelProviders.OLLAMA | ChatModelProviders.LM_STUDIO;

/** Discovered local service info */
interface LocalService {
  id: string;
  name: string;
  url: string;
  kind: LocalServiceKind;
}

/** Simple model info for local services */
interface LocalModel {
  id: string;
  name: string;
}

/** Normalize URL: trim, remove trailing slashes and /v1 suffix */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/** Fetch models from a local service */
async function fetchModelsFromService(url: string, kind: LocalServiceKind): Promise<LocalModel[]> {
  const normalizedUrl = normalizeBaseUrl(url);

  if (kind === ChatModelProviders.OLLAMA) {
    const res = await requestUrl({ url: `${normalizedUrl}/api/tags`, method: "GET" });
    const models = res.json?.models || [];
    return models.map((m: { name: string }) => ({ id: m.name, name: m.name }));
  }

  // LM Studio (OpenAI-compatible)
  const res = await requestUrl({ url: `${normalizedUrl}/v1/models`, method: "GET" });
  const data = res.json?.data || [];
  return data.map((m: { id: string }) => ({ id: m.id, name: m.id }));
}

interface LocalServiceItemProps {
  service: LocalService;
  expanded: boolean;
  onToggleExpand: () => void;
}

/** Single local service item - matches existing Provider item style */
function LocalServiceItem({ service, expanded, onToggleExpand }: LocalServiceItemProps) {
  const settings = useSettingsValue();
  const [url, setUrl] = useState(service.url);
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [verifying, setVerifying] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedModels = await fetchModelsFromService(url, service.kind);
      setModels(fetchedModels);
    } catch (err) {
      logError(`Error fetching models for ${service.name}:`, err);
      setError(err2String(err));
      setModels(null);
    } finally {
      setLoading(false);
    }
  };

  const handleAddModelClick = () => {
    onToggleExpand();
    if (!expanded && !models && !loading) {
      fetchModels();
    }
  };

  const verifyAndAddModel = async () => {
    if (!selectedModelId || !models) return;

    const model = models.find((m) => m.id === selectedModelId);
    if (!model) return;

    setVerifying(true);
    let verificationFailed = false;
    let verificationError = "";

    try {
      const provider = service.kind;
      const normalizedUrl = normalizeBaseUrl(url);
      const baseUrl =
        service.kind === ChatModelProviders.OLLAMA ? normalizedUrl : `${normalizedUrl}/v1`;

      const customModel: CustomModel = {
        name: model.name,
        provider,
        baseUrl,
        enabled: true,
      };

      // Verify model
      try {
        await ProjectManager.instance.getCurrentChainManager().chatModelManager.ping(customModel);
      } catch (err) {
        verificationFailed = true;
        verificationError = err2String(err);
        logError("Model verification failed:", err);
      }

      // Check if model already exists (use name + provider for dedup)
      const exists = settings.activeModels.find(
        (m) => m.name === customModel.name && m.provider === customModel.provider
      );

      // Show appropriate notice
      if (!exists) {
        updateSetting("activeModels", [...settings.activeModels, customModel]);
        if (verificationFailed) {
          new Notice(`Model ${model.name} added (verification failed: ${verificationError})`, 5000);
        } else {
          new Notice(`Model ${model.name} added!`);
        }
      } else {
        if (verificationFailed) {
          new Notice(
            `Model ${model.name} already exists (verification failed: ${verificationError})`,
            5000
          );
        } else {
          new Notice(`Model ${model.name} already exists.`);
        }
      }
    } catch (err) {
      new Notice(`Failed to add model: ${err2String(err)}`);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-flex tw-items-end tw-gap-2 tw-font-medium">
        <div className="tw-truncate">{service.name}</div>
      </div>
      <div className="tw-flex tw-flex-row tw-items-center tw-gap-2">
        <div className="tw-flex-1">
          <Input
            className="tw-max-w-full"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              // Clear models when URL changes
              setModels(null);
              setSelectedModelId("");
              setError(null);
            }}
          />
        </div>
        <div>
          <Button
            onClick={handleAddModelClick}
            variant="secondary"
            className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-px-4 tw-py-2"
          >
            Add Model
            {expanded ? (
              <ChevronUp className="tw-ml-1 tw-size-4" />
            ) : (
              <ChevronDown className="tw-ml-1 tw-size-4" />
            )}
          </Button>
        </div>
      </div>

      <Collapsible open={expanded} className="tw-mt-2">
        <CollapsibleContent className="tw-rounded-md tw-p-3">
          <FormField label="Model" description="Add the currently selected model to model List.">
            <div>
              <div className="tw-flex tw-items-center tw-gap-2">
                <div className="tw-flex-1">
                  <ObsidianNativeSelect
                    options={
                      models
                        ? [...models]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((m) => ({ label: m.name, value: m.id }))
                        : []
                    }
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    value={selectedModelId}
                    placeholder="Select Model"
                    disabled={loading || !!error}
                  />
                </div>
                <div className="tw-w-[72px]">
                  <Button
                    onClick={verifyAndAddModel}
                    disabled={!selectedModelId || verifying}
                    variant="secondary"
                    size="sm"
                    className="tw-w-full tw-whitespace-nowrap"
                  >
                    {verifying ? <Loader2 className="tw-size-4 tw-animate-spin" /> : "Add"}
                  </Button>
                </div>
              </div>
              <div className="tw-mt-1 tw-text-xs">
                {loading && <div className="tw-p-1 tw-text-muted">Loading models...</div>}
                {error && <div className="tw-p-1 tw-text-error">Failed: {error}</div>}
                {models && models.length === 0 && (
                  <div className="tw-p-1 tw-text-muted">No models found.</div>
                )}
              </div>
            </div>
          </FormField>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** Main section component for local services */
export function LocalServicesSection() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fixed local providers
  const localProviders: LocalService[] = [
    {
      id: "ollama",
      name: "Ollama",
      url: "http://localhost:11434",
      kind: ChatModelProviders.OLLAMA,
    },
    {
      id: "lm-studio",
      name: "LM Studio",
      url: "http://localhost:1234",
      kind: ChatModelProviders.LM_STUDIO,
    },
  ];

  return (
    <div className="tw-mt-6 tw-border-t tw-border-border tw-pt-4">
      {/* Header */}
      <div className="tw-mb-3">
        <h3 className="tw-m-0 tw-text-base tw-font-bold">Local Services</h3>
        <div className="tw-mt-1 tw-text-xs tw-text-muted">
          Need help?{" "}
          <a
            href="https://github.com/logancyang/obsidian-copilot/blob/master/local_copilot.md"
            target="_blank"
            rel="noopener noreferrer"
            className="tw-text-accent hover:tw-text-accent-hover"
          >
            Setup guide
          </a>
        </div>
      </div>

      {/* Fixed Provider List */}
      <div className="tw-space-y-4">
        {localProviders.map((service) => (
          <LocalServiceItem
            key={service.id}
            service={service}
            expanded={expandedId === service.id}
            onToggleExpand={() =>
              setExpandedId((prev) => (prev === service.id ? null : service.id))
            }
          />
        ))}
      </div>
    </div>
  );
}
