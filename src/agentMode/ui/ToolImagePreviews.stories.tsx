import { ToolImagePreviews, type ToolImagePreviewsProps } from "@/agentMode/ui/ToolImagePreviews";
import type { Meta, StoryObj } from "@/lib/story";

const diagram =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTYwIiB2aWV3Qm94PSIwIDAgMjQwIDE2MCI+PHJlY3Qgd2lkdGg9IjI0MCIgaGVpZ2h0PSIxNjAiIGZpbGw9IiNlZGYyZjciLz48cmVjdCB4PSIyMCIgeT0iNTAiIHdpZHRoPSI3NSIgaGVpZ2h0PSI2MCIgcng9IjgiIGZpbGw9IiM2MzViZmYiLz48cGF0aCBkPSJNOTUgODBoNTAiIHN0cm9rZT0iIzY0NzQ4YiIgc3Ryb2tlLXdpZHRoPSI0Ii8+PHJlY3QgeD0iMTQ1IiB5PSI1MCIgd2lkdGg9Ijc1IiBoZWlnaHQ9IjYwIiByeD0iOCIgZmlsbD0iIzE0YjhhNiIvPjwvc3ZnPg==";
const image = { type: "image" as const, mimeType: "image/svg+xml", data: diagram };

const meta = {
  title: "Agent Mode/Tool Image Previews",
  component: ToolImagePreviews,
  args: { label: "Read architecture.svg", outputs: [image] },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ToolImagePreviewsProps>;
export default meta;

export const SingleImage: StoryObj<ToolImagePreviewsProps> = {};
export const MultipleImages: StoryObj<ToolImagePreviewsProps> = {
  args: { outputs: [image, image, image, image, image] },
};
export const ShrinkingImage: StoryObj<ToolImagePreviewsProps> = {
  args: { outputs: [image, { type: "image_pending", key: "chart" }] },
};
export const TextOnly: StoryObj<ToolImagePreviewsProps> = {
  args: { outputs: [{ type: "text", text: "Read note" }] },
};
