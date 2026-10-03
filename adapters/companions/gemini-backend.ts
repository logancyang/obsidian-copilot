import { contextTokens } from "./context-budget";
export function contextWindowForModel(modelId: string): number | undefined {
  return DEFAULT_GEMINI_MODELS.find((model) => model.modelId === modelId)?._meta.totalContextTokens;
}
export const DEFAULT_GEMINI_MODELS = [
  {
    modelId: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description:
      "Google's newest frontier workhorse for long-horizon coding and autonomous agentic workflows (1M context, 64K output)",
    _meta: {
      supportsReasoningEffort: true,
      reasoningEfforts: [{ value: "low" }, { value: "medium" }, { value: "high" }],
      totalContextTokens: 1048576,
    },
  },
  {
    modelId: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    description: "High-speed multimodal reasoning, deep code review, and interactive streaming",
    _meta: {
      supportsReasoningEffort: true,
      reasoningEfforts: [{ value: "low" }, { value: "medium" }, { value: "high" }],
      totalContextTokens: 1048576,
    },
  },
  {
    modelId: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    description: "Balanced performance, economy, and reasoning capability",
    _meta: {
      supportsReasoningEffort: true,
      reasoningEfforts: [{ value: "low" }, { value: "medium" }, { value: "high" }],
      totalContextTokens: 1048576,
    },
  },
  {
    modelId: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    description:
      "Google's flagship model for deep reasoning, architectural design, and complex algorithms",
    _meta: {
      supportsReasoningEffort: true,
      reasoningEfforts: [{ value: "low" }, { value: "high" }],
      totalContextTokens: 1048576,
    },
  },
  {
    modelId: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Thinking)",
    description: "Anthropic frontier reasoning and refactoring model via Antigravity",
    _meta: {
      supportsReasoningEffort: false,
      totalContextTokens: 200000,
    },
  },
  {
    modelId: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 (Thinking)",
    description: "Anthropic flagship model for holistic system architecture via Antigravity",
    _meta: {
      supportsReasoningEffort: false,
      totalContextTokens: 200000,
    },
  },
  {
    modelId: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B (Medium)",
    description: "Open-weight frontier model hosted via Antigravity",
    _meta: {
      supportsReasoningEffort: false,
      totalContextTokens: 131072,
    },
  },
];
export interface AgyModelEntry {
  modelId: string;
  name: string;
  description?: string;
  _meta: {
    supportsReasoningEffort?: boolean;
    reasoningEfforts?: Array<{
      value: string;
    }>;
    totalContextTokens?: number;
    contextQuality?: "verified" | "estimated" | "unknown";
    contextLimits?: import("./context-budget").ModelContextLimits;
  };
}
export function parseAgyModelsOutput(output: string): {
  rawModels: Array<{
    modelId: string;
    name: string;
  }>;
  availableModels: AgyModelEntry[];
} {
  if (/^\s*[[{]/.test(output)) {
    try {
      const body: unknown = JSON.parse(output);
      const rows = Array.isArray(body)
        ? body
        : body && typeof body === "object" && "models" in body
          ? body.models
          : undefined;
      if (Array.isArray(rows)) {
        const availableModels: AgyModelEntry[] = rows.flatMap((value: unknown) => {
          if (!value || typeof value !== "object") return [];
          const row = value as Record<string, unknown>;
          const modelId = row.modelId ?? row.id;
          if (typeof modelId !== "string" || !modelId || row.hidden === true) return [];
          const meta = row._meta as Record<string, unknown> | undefined;
          const known = DEFAULT_GEMINI_MODELS.find((model) => model.modelId === modelId)?._meta;
          const rawEfforts = row.reasoningEfforts ?? meta?.reasoningEfforts;
          const reasoningEfforts = Array.isArray(rawEfforts)
            ? [
                ...new Set(
                  rawEfforts.flatMap((entry: unknown) => {
                    const value =
                      typeof entry === "string"
                        ? entry
                        : entry && typeof entry === "object" && "value" in entry
                          ? entry.value
                          : undefined;
                    return typeof value === "string" && value.length ? [value] : [];
                  })
                ),
              ].map((value) => ({ value }))
            : known && "reasoningEfforts" in known
              ? known.reasoningEfforts
              : undefined;
          const declaredSupport = row.supportsReasoningEffort ?? meta?.supportsReasoningEffort;
          const supportsReasoningEffort =
            typeof declaredSupport === "boolean"
              ? declaredSupport
              : Array.isArray(rawEfforts)
                ? reasoningEfforts!.length > 0
                : known?.supportsReasoningEffort;
          const size = contextTokens(
            row.context_window ??
              row.contextLimit ??
              (row._meta as Record<string, unknown> | undefined)?.totalContextTokens
          );
          const input = contextTokens(row.inputTokenLimit);
          return [
            {
              modelId,
              name:
                typeof row.name === "string"
                  ? row.name
                  : typeof row.displayName === "string"
                    ? row.displayName
                    : modelId,
              _meta: {
                supportsReasoningEffort,
                reasoningEfforts,
                totalContextTokens: input ?? size,
                contextQuality: size || input ? "verified" : "unknown",
                contextLimits: {
                  contextWindow: size,
                  inputTokenLimit: input,
                  outputTokenLimit: contextTokens(row.outputTokenLimit),
                },
              },
            },
          ];
        });
        return {
          availableModels,
          rawModels: availableModels.map((row) => ({ modelId: row.modelId, name: row.name })),
        };
      }
    } catch {}
  }
  const lines = output.trim().split(/\r?\n/);
  const rawModels: Array<{
    modelId: string;
    name: string;
  }> = [];
  const grouped = new Map<
    string,
    {
      baseName: string;
      efforts: string[];
    }
  >();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Fetching")) continue;
    const parts = line.split(/\t+/);
    const modelId = parts[0]?.trim();
    if (!modelId) continue;
    const displayName = parts[1]?.trim() || modelId;
    rawModels.push({ modelId, name: displayName });
    const fixed =
      DEFAULT_GEMINI_MODELS.find((model) => model.modelId === modelId)?._meta
        .supportsReasoningEffort === false;
    const match = fixed ? null : /^(.*)-(high|medium|low)$/.exec(modelId);
    if (match) {
      const baseId = match[1];
      const effort = match[2];
      const baseName = displayName.replace(/\s*\((?:High|Medium|Low)\)$/i, "").trim();
      let group = grouped.get(baseId);
      if (!group) {
        group = { baseName, efforts: [] };
        grouped.set(baseId, group);
      }
      if (!group.efforts.includes(effort)) {
        group.efforts.push(effort);
      }
    } else {
      const existing = grouped.get(modelId);
      grouped.set(modelId, { baseName: displayName, efforts: existing?.efforts ?? [] });
    }
  }
  const availableModels: AgyModelEntry[] = [];
  const effortOrder = ["low", "medium", "high"];
  for (const [baseId, info] of grouped.entries()) {
    const orderedEfforts = effortOrder
      .filter((e) => info.efforts.includes(e))
      .map((value) => ({ value }));
    const known = DEFAULT_GEMINI_MODELS.find((model) => model.modelId === baseId)?._meta;
    availableModels.push({
      modelId: baseId,
      name: info.baseName,
      _meta: {
        supportsReasoningEffort:
          orderedEfforts.length > 0 || known?.supportsReasoningEffort === true,
        totalContextTokens: contextWindowForModel(baseId),
        contextQuality: "estimated",
        ...(orderedEfforts.length > 0
          ? { reasoningEfforts: orderedEfforts }
          : known && "reasoningEfforts" in known
            ? { reasoningEfforts: known.reasoningEfforts }
            : {}),
      },
    });
  }
  return { rawModels, availableModels };
}
