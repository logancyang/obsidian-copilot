import type { Meta, StoryObj } from "@/lib/story";
import { ModelChecklist, type ModelChecklistProps } from "./ModelChecklist";

const meta = {
  title: "Settings/Model Checklist",
  component: ModelChecklist,
  args: {
    availableModels: [],
    selected: new Set<string>(),
    onToggle: () => {},
    onAddId: () => {},
    query: "",
    onQueryChange: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ModelChecklistProps>;
export default meta;

export const ManualEntry: StoryObj<ModelChecklistProps> = {
  args: {
    modelInputHint: "e.g. qwen/qwen3.8-27b",
    fetchError: "Endpoint did not return a model list.",
  },
};

export const DiscoveredModels: StoryObj<ModelChecklistProps> = {
  args: {
    availableModels: [
      { id: "qwen/qwen3.8-27b", displayName: "Qwen 3.8 27B" },
      { id: "text-embedding-3-small", displayName: "Text Embedding 3 Small", isEmbedding: true },
    ],
  },
};

/** Similar names, full provider IDs and metadata must remain readable without hovering. */
export const LongModelNames: StoryObj<ModelChecklistProps> = {
  args: {
    availableModels: [
      {
        id: "text-embedding-3-small",
        displayName: "Text Embedding 3 Small",
        isEmbedding: true,
        limits: { context: 8191 },
        releaseDate: "2024-01-25",
      },
      {
        id: "text-embedding-3-large",
        displayName: "Text Embedding 3 Large",
        isEmbedding: true,
        limits: { context: 8191 },
        releaseDate: "2024-01-25",
      },
      {
        id: "local-provider/organization-qwen3-coder-480b-a35b-instruct-2025-09-extended-context",
        displayName:
          "local-provider/organization-qwen3-coder-480b-a35b-instruct-2025-09-extended-context",
        modalities: { input: ["text"] },
        limits: { context: 262144 },
        releaseDate: "2025-09-01",
      },
      {
        id: "local-provider/organization-qwen3-coder-480b-a35b-instruct-2025-09-standard-context",
        displayName:
          "local-provider/organization-qwen3-coder-480b-a35b-instruct-2025-09-standard-context",
        modalities: { input: ["text", "image"] },
        limits: { context: 131072 },
        releaseDate: "2025-09-01",
      },
    ],
    selected: new Set(["text-embedding-3-small"]),
    customIds: new Set([
      "local-provider/organization-qwen3-coder-480b-a35b-instruct-2025-09-extended-context",
    ]),
    onRemoveId: () => {},
  },
};
