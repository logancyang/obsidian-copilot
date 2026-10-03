export interface AgentModel {
  modelId: string;
  name?: string;
  description?: string;
  _meta?: {
    reasoningEfforts?: Array<{ value: string }>;
    supportsReasoningEffort?: boolean;
    reasoningEffort?: string;
  };
}

export interface AgentCatalog {
  currentModelId?: string;
  availableModels: AgentModel[];
}

export function catalogOptions(
  catalog: AgentCatalog,
  effort?: string,
  efforts?: readonly string[]
) {
  const current = catalog.availableModels.find((model) => model.modelId === catalog.currentModelId);
  const levels = efforts ?? current?._meta?.reasoningEfforts?.map((entry) => entry.value) ?? [];
  effort ??= current?._meta?.reasoningEffort;
  return [
    {
      id: "model",
      type: "select",
      category: "model",
      name: "Model",
      currentValue: catalog.currentModelId ?? catalog.availableModels[0]?.modelId ?? "",
      options: catalog.availableModels.map((model) => ({
        value: model.modelId,
        name: model.name ?? model.modelId,
        description: model.description,
      })),
    },
    ...(levels.length
      ? [
          {
            id: "reasoning_effort",
            type: "select",
            category: "thought_level",
            name: "Reasoning effort",
            currentValue:
              effort && levels.includes(effort)
                ? effort
                : levels.includes("medium")
                  ? "medium"
                  : levels[0],
            options: levels.map((value) => ({ value, name: value })),
          },
        ]
      : []),
  ];
}

export function normalizeCatalogResponse<
  T extends {
    [key: string]: unknown;
    models?: AgentCatalog;
    _meta?: { models?: AgentCatalog; reasoningEffort?: string };
  },
>(response: T, efforts?: readonly string[]): T {
  const models = response.models ?? response._meta?.models;
  return models?.availableModels
    ? {
        ...response,
        models,
        configOptions: catalogOptions(models, response._meta?.reasoningEffort, efforts),
      }
    : response;
}
