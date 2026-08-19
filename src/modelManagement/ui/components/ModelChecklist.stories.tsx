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
